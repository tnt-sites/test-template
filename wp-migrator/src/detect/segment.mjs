/**
 * Builder-agnostic top-level section detection.
 *
 * Finds the page's content sections from rendered geometry alone — no
 * Elementor/Gutenberg/Divi markup assumptions. The header and footer are
 * excluded first (they carry their own nested "sections" in most page
 * builders, which must not be mistaken for body content), then the body's
 * real content root is found by burrowing through wrapper divs, and its
 * direct children become the section candidates.
 *
 * Each detected section is stamped with a marker attribute so the caller can
 * address it with a plain selector afterward (capture/section.mjs's
 * captureSection takes a selector, not a live handle).
 */

export const SEGMENT_MARK = "data-wpmig-sec";

function AUTO_SEGMENT({ mark, foldBelowPx, minTextLen, splitSidebars }) {
  const elementChildren = (el) => [...el.children];

  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
    };
  };

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const alphaOf = (color) => {
    const m = (color || "").match(/rgba?\(([^)]+)\)/);
    if (!m) return color && color !== "transparent" ? 1 : 0;
    const parts = m[1].split(",").map(parseFloat);
    return parts.length > 3 ? parts[3] : 1;
  };

  const paints = (el) => {
    const cs = getComputedStyle(el);
    if (cs.backgroundImage !== "none") return true;
    if (alphaOf(cs.backgroundColor) > 0.02) return true;
    if (["Top", "Right", "Bottom", "Left"].some((s) => parseFloat(cs[`border${s}Width`]) > 0))
      return true;
    if (cs.boxShadow !== "none") return true;
    for (const ps of ["::before", "::after"]) {
      const pcs = getComputedStyle(el, ps);
      if (pcs.content !== "none" && pcs.content !== "normal") return true;
    }
    return false;
  };

  const isVisible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    const r = rect(el);
    return r.w > 0 && r.h > 0;
  };

  // Screen-reader-only utility elements (skip links, visually-hidden labels)
  // are typically clipped to ~1px so assistive tech still finds them in the
  // DOM. They render as "visible" by the box-size test above but carry no
  // real layout weight, and a sibling of the real content wrapper, they
  // defeat the "exactly one significant child" test used to burrow down to
  // it. A minimum footprint filters them out without excluding genuinely
  // short-but-full-width sections (a thin CTA bar is short, not narrow).
  const isNegligible = (el) => {
    const r = rect(el);
    // A collapsed embed, a hidden widget rendering with no real box, or a
    // similar degenerate element can still report a nonzero area (a 1180px
    // by 1px sliver clears any *area* threshold) while carrying no visible
    // content — filtered on either dimension independently, not just area.
    return r.w < 10 || r.h < 3 || r.w * r.h < 50;
  };
  const isSignificant = (el) => isVisible(el) && !isNegligible(el);

  /**
   * A decorative overlay (`.elementor-background-overlay` and the like) is
   * almost always `position: absolute`, sized to fill its parent — which
   * makes it indistinguishable from a real full-width sibling section by
   * geometry alone unless position is taken into account. Real sections
   * stack in normal flow and *add* height to their container; an absolutely
   * positioned child does neither, so it's excluded from every flow/fan-out
   * decision (though it can still make its parent "paint").
   */
  const isFlowKid = (el) => {
    if (!isSignificant(el)) return false;
    const pos = getComputedStyle(el).position;
    return pos !== "absolute" && pos !== "fixed";
  };

  // ---- chrome: header / footer -------------------------------------------
  const findLandmark = (primary, fallback) => {
    const found = document.querySelector(primary);
    if (found) return found;
    for (const sel of fallback) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  };

  /**
   * A class-named fallback is only trustworthy where a landmark would have
   * been: `.header` on a hero band is content, `.header` as the first thing in
   * the body is chrome. Position decides, not the name.
   */
  const atDocumentTop = (el) => el && rect(el).y + window.scrollY < 200;
  const header =
    findLandmark('header, [role="banner"]', ["#masthead", ".site-header", "#header"]) ||
    [".header", ".main-header", "#site-header", ".top-bar"]
      .map((sel) => document.querySelector(sel))
      .find((el) => el && atDocumentTop(el) && !el.closest("main, [role='main'], article"));
  const footer = findLandmark('footer, [role="contentinfo"]', [
    "#colophon",
    ".site-footer",
    "#footer",
  ]);

  /**
   * The primary navigation is frequently a sibling of the header rather than a
   * child of it (a sticky bar under a logo strip is the common shape). Outside
   * the header element, nothing above excludes it, so it segments as a content
   * section — 100+ props of menu links, and a nav bar rendered twice on the
   * migrated page since the target draws its own from `mainNav.json`.
   *
   * Identified by what it is rather than where: a nav landmark at the top of
   * the document whose text is almost entirely link text.
   */
  const siteNavs = [...document.querySelectorAll('nav, [role="navigation"]')].filter((el) => {
    if (header?.contains(el) || footer?.contains(el)) return false;
    if (!atDocumentTop(el)) return false;
    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (!text) return false;
    const linkText = [...el.querySelectorAll("a")]
      .map((a) => (a.textContent || "").replace(/\s+/g, " ").trim())
      .join(" ");
    return linkText.length / text.length > 0.7;
  });

  // ---- chrome: full-viewport overlays (popups, cookie walls) ------------
  const isOverlay = (el) => {
    if (header?.contains(el) || footer?.contains(el)) return false;
    const cs = getComputedStyle(el);
    if (cs.position !== "fixed" && cs.position !== "sticky") return false;
    const r = rect(el);
    if ((r.w * r.h) / (vw * vh) > 0.35) return true;
    return /modal|popup|dialog|overlay|lightbox/i.test(`${el.id} ${el.className}`);
  };

  const overlays = [...document.body.querySelectorAll("*")].filter(isOverlay);
  const isChrome = (el) =>
    el === header ||
    el === footer ||
    (header?.contains(el) ?? false) ||
    (footer?.contains(el) ?? false) ||
    siteNavs.some((n) => n === el || n.contains(el)) ||
    overlays.some((o) => o === el || o.contains(el));

  // ---- pass-through wrapper test (geometry only) -------------------------
  const isPassThrough = (el) => {
    if (paints(el)) return false;
    if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return false;
    const kids = elementChildren(el).filter((k) => !isChrome(k) && isFlowKid(k));
    if (kids.length !== 1) return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none") return false;
    const er = rect(el);
    const kr = rect(kids[0]);
    if (er.w <= 0 || er.h <= 0) return false;
    return (kr.w * kr.h) / (er.w * er.h) >= 0.9;
  };

  /**
   * Burrow from `start` through single-significant-child wrappers until
   * reaching an element with zero or multiple significant children — the
   * point where the tree actually fans out. Also reports how many hops that
   * took: a normal section's own widgets sit a fixed, shallow number of
   * wrapper levels below its root (section > container > column >
   * widget-wrap, then straight to its widgets) regardless of what builder
   * produced it. Reaching a fan-out that much deeper is the signature of an
   * *extra* nested thing in between — a whole embedded builder instance, not
   * just one section's own composition — and is the signal `expandCandidate`
   * uses to tell "unwrap this compound wrapper" apart from "this is one
   * section's eyebrow-heading-body stack, leave it alone."
   */
  const burrowToFanOut = (start) => {
    let node = start;
    let hops = 0;
    let guard = 0;
    while (guard++ < 20) {
      const kids = elementChildren(node).filter((k) => !isChrome(k) && isFlowKid(k));
      if (kids.length !== 1) break;
      const only = kids[0];
      const grandkids = elementChildren(only).filter((k) => !isChrome(k) && isFlowKid(k));
      if (grandkids.length <= 1 && !isPassThrough(only)) break;
      node = only;
      hops++;
    }
    return { node, hops };
  };

  // ---- find the body content root ----------------------------------------
  const root = burrowToFanOut(document.body).node;

  // ---- candidate sections: direct children of the content root ----------
  const rawCandidates = elementChildren(root).filter((k) => !isChrome(k) && isFlowKid(k));

  /**
   * Why a candidate that looks like more than one design was left whole.
   * Keyed by element; surfaced on the returned descriptor as `review` so the
   * caller can ask a human rather than silently baking a page into one
   * component.
   */
  const reviewNotes = new Map();

  /** Share of an element's text that sits inside links. */
  const linkTextRatio = (el) => {
    const text = (el.innerText || "").replace(/\s+/g, " ").trim();

    if (!text) return 0;
    const linkText = [...el.querySelectorAll("a")]
      .map((a) => (a.innerText || "").replace(/\s+/g, " ").trim())
      .join(" ");

    return linkText.length / text.length;
  };

  /**
   * A sidebar column beside the page's main content.
   *
   * This is the one horizontal split that must not be treated as a single
   * design. An interior page's row of [side menu, content column] fails the
   * `allSpanWidth` test below — neither child is full width — so the whole row
   * was kept as one section, and the entire page body became one component:
   * the side menu, the headings and every paragraph baked together, repeated
   * once per page because no two pages' prose hash alike.
   *
   * Recognised by role first (`aside`, `role="complementary"`, a themed class
   * name), then by shape: a narrow column whose text is mostly link text is a
   * nav rail whatever it calls itself. Width alone is deliberately not enough
   * — a narrow column of prose beside an image is one design, and splitting it
   * would be wrong.
   */
  const SIDEBAR_MAX_WIDTH_RATIO = 0.45;
  const MAIN_MIN_WIDTH_RATIO = 0.5;

  const isSidebarLike = (el, parentBox) => {
    if (!(parentBox.w > 0)) return false;
    if (rect(el).w / parentBox.w > SIDEBAR_MAX_WIDTH_RATIO) return false;
    if (el.matches('aside, [role="complementary"]')) return true;

    const names = `${el.id || ""} ${el.getAttribute("class") || ""}`;

    if (/(^|[\s_-])(sidebar|side-nav|side-menu|secondary|widget-area)/i.test(names)) return true;
    // A nav rail: several links, and text that is overwhelmingly those links.
    return el.querySelectorAll("a").length >= 3 && linkTextRatio(el) > 0.6;
  };

  /**
   * Split a [sidebar, main] row into the sidebar and the main column's own
   * sections. Returns null when the row is not that shape, which leaves every
   * other two-column layout to the existing full-width logic.
   *
   * Exactly two children is deliberate. A third column is ambiguous — it could
   * be a second rail or a genuine three-up design — and guessing there would
   * re-introduce the class of error this is meant to remove.
   */
  const splitSidebarRow = (el) => {
    const { node } = burrowToFanOut(el);
    const kids = elementChildren(node).filter((k) => !isChrome(k) && isFlowKid(k));

    if (kids.length !== 2) return null;

    const parentBox = rect(node);
    const sidebars = kids.filter((k) => isSidebarLike(k, parentBox));

    if (sidebars.length !== 1) return null;

    const sidebar = sidebars[0];
    const main = kids.find((k) => k !== sidebar);

    if (rect(main).w / parentBox.w < MAIN_MIN_WIDTH_RATIO) return null;
    return { sidebar, main };
  };

  /**
   * A page builder commonly routes an interior page through a "single
   * template" that wraps the *entire* real body in one more top-level
   * section (its own content living several pass-through levels deeper, in
   * a post-content widget). That candidate is not one design — it is a
   * container for many. Detecting it generically means asking the same
   * question recursively: does *this* candidate itself fan out into several
   * children that look like a stack of distinct sections (each spanning
   * close to the full width, tall enough to be a section, and not a
   * uniform repeat — a repeat is a card grid, not a section stack, and
   * `detectRepeats` handles that separately)? If so, expand into them.
   */
  const shapeTokens = (el, depth = 0, out = []) => {
    if (depth > 4) return out;
    out.push(el.tagName);
    for (const c of elementChildren(el)) shapeTokens(c, depth + 1, out);
    return out;
  };
  const levenshtein = (a, b) => {
    const m = a.length;
    const n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(
          prev[j] + 1,
          cur[j - 1] + 1,
          prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
      prev = cur;
    }
    return prev[n];
  };
  const isUniformRepeat = (kids) => {
    if (kids.length < 2) return false;
    if (!kids.every((k) => k.tagName === kids[0].tagName)) return false;

    // A builder wraps everything in the same narrow scaffolding spine
    // (section > container > column > widget-wrap > ...) before content
    // ever branches, so a shallow-depth shape comparison alone cannot tell
    // a 12,000px section stack apart from a 250px band — both start with an
    // identical single-child chain. Genuine repeated grid/row items never
    // vary this wildly in rendered height (text-length differences produce
    // maybe 1.5–2x, not 10x+), so a large height spread is decisive on its
    // own regardless of what the shape comparison below finds.
    const heights = kids.map((k) => rect(k).h).filter((h) => h > 0);
    if (heights.length >= 2) {
      const maxH = Math.max(...heights);
      const minH = Math.min(...heights);
      if (maxH / Math.max(minH, 1) > 2.5) return false;
    }

    const tokenSets = kids.map((k) => shapeTokens(k));
    for (let i = 0; i < tokenSets.length; i++) {
      for (let j = i + 1; j < tokenSets.length; j++) {
        const max = Math.max(tokenSets[i].length, tokenSets[j].length) || 1;
        const dist = levenshtein(tokenSets[i], tokenSets[j]) / max;
        if (dist > 0.3) return false; // structurally different — not a repeat
      }
    }
    return true;
  };

  // A compound wrapper (a "single template" holding the entire real body, or
  // similar) and one section's own eyebrow/heading/body composition are
  // geometrically identical by every shape signal available: both are
  // "N full-width children, not a uniform repeat, reached through the same
  // few pass-through levels" (the widget chain to reach a section's own
  // widgets and the chain to reach a compound wrapper's real content happen
  // to be the same length here). What actually sets them apart is scale: a
  // compound wrapper is implausibly tall for a single design because it
  // *is* several designs stacked. The largest genuine single section
  // measured anywhere on this site tops out around 2100px (a services grid
  // with seven cards); a generous multiple of that is a safe ceiling for
  // "plausibly one section" without risking real hero/grid sections.
  const MAX_PLAUSIBLE_SECTION_HEIGHT = 2600;

  const expandCandidate = (el, depth) => {
    if (depth > 8) return [el]; // generous safety cap; the height gate does the real work

    // A sidebar row is split on shape, not size. The side menu is the same
    // furniture on every page that carries it, and the column beside it is
    // that page's real content — keeping them together is what turned whole
    // pages into single components, at any height.
    if (splitSidebars) {
      const row = splitSidebarRow(el);

      if (row) return [row.sidebar, ...expandCandidate(row.main, depth + 1)];
    }

    const oversized = rect(el).h > MAX_PLAUSIBLE_SECTION_HEIGHT;

    // Below the ceiling a candidate is taken at its word: it is plausibly one
    // design, and nothing here is confident enough to overrule that.
    if (!oversized) return [el];

    /** Leave `el` whole, and record why so a human can second-guess it. */
    const keepWhole = (reason) => {
      reviewNotes.set(el, reason);
      return [el];
    };

    const { node } = burrowToFanOut(el);
    const kids = elementChildren(node).filter((k) => !isChrome(k) && isFlowKid(k));
    if (kids.length < 2) return keepWhole("no fan-out below it — one child all the way down");
    if (isUniformRepeat(kids)) return [el]; // a grid/row of similar items is one design

    // Full width for every kid is the signal that distinguishes a vertical
    // stack of sections from a horizontal row of columns — required outright.
    // Height is softer: a real section stack can legitimately include one
    // short spacer or a collapsed embed, so only a majority need clear the
    // bar rather than every single one (a lone short section is handled
    // downstream by the fold-into-previous step instead).
    const parentBox = rect(node);
    const allSpanWidth = kids.every((k) => parentBox.w > 0 && rect(k).w / parentBox.w >= 0.85);
    if (!allSpanWidth)
      return keepWhole("children sit side by side rather than stacked — a multi-column layout");
    const tallEnoughShare = kids.filter((k) => rect(k).h >= 40).length / kids.length;
    if (tallEnoughShare < 0.6)
      return keepWhole("most children are too short to be sections of their own");

    return kids.flatMap((k) => expandCandidate(k, depth + 1));
  };

  const expandedCandidates = rawCandidates.flatMap((c) => expandCandidate(c, 0));

  const hasImagery = (el) => el.querySelector("img,svg,video,iframe,picture") !== null;
  const textLen = (el) => (el.innerText || "").trim().length;

  const scored = expandedCandidates.map((el) => ({
    el,
    box: rect(el),
    hasImagery: hasImagery(el),
    textLen: textLen(el),
    heading: el.querySelector("h1,h2") !== null,
  }));

  // ---- fold tiny, imageless, textless candidates into the previous one --
  const kept = [];
  for (const c of scored) {
    const tiny = c.box.h < foldBelowPx && !c.hasImagery && c.textLen < minTextLen;
    if (tiny && kept.length) kept[kept.length - 1].folded.push(c.el);
    else kept.push({ ...c, folded: [] });
  }

  // ---- stamp + describe ---------------------------------------------------
  kept.forEach((c, n) => c.el.setAttribute(mark, String(n)));

  /**
   * The colour a section actually sits on.
   *
   * A page builder paints a band on whichever wrapper it likes, and often not
   * on the element that segmentation picks as the section: this site's FAQ band
   * is `#f4f8f7` on an ancestor while the section root itself is transparent.
   * Reading only the root therefore reports "no band" for a section that
   * plainly has one — and when the section is later split (a lead run plus its
   * accordion), the half that does not carry its own paint comes out white
   * against a grey neighbour that was one continuous band in the source.
   *
   * So resolve it the way a viewer sees it: the nearest ancestor that actually
   * paints. `rgba(0, 0, 0, 0)` is how a computed style spells transparent.
   */
  const effectiveBackground = (el) => {
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      if (bg && alphaOf(bg) > 0.02) return bg;
    }
    return "";
  };

  return kept.map((c, n) => ({
    n,
    tag: c.el.tagName.toLowerCase(),
    box: c.box,
    hasImagery: c.hasImagery,
    hasHeading: c.heading,
    ownBackground: getComputedStyle(c.el).backgroundColor,
    background: effectiveBackground(c.el),
    textPreview: (c.el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 80),
    folded: c.folded.length,
    review: reviewNotes.get(c.el) || null,
  }));
}

/**
 * Run auto-segmentation on an already-loaded, settled page.
 * Returns section descriptors; each section's root element is stamped with
 * `[data-wpmig-sec="N"]`, addressable by `sectionSelector(n)`.
 */
export async function autoSegment(page, opts = {}) {
  const { foldBelowPx = 40, minTextLen = 8, splitSidebars = true } = opts;
  return page.evaluate(AUTO_SEGMENT, {
    mark: SEGMENT_MARK,
    foldBelowPx,
    minTextLen,
    splitSidebars,
  });
}

export function sectionSelector(n) {
  return `[${SEGMENT_MARK}="${n}"]`;
}
