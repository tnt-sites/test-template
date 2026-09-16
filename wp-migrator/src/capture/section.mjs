/**
 * Section capture: turn one rendered section of a WordPress page into
 *
 *   1. a sanitized *template tree* — the semantic structure with builder
 *      scaffolding collapsed and every class/id/data-attr stripped, and
 *   2. a per-breakpoint *computed-style snapshot* for every retained node,
 *      including ::before/::after and CDP-forced :hover states.
 *
 * Everything here reads the rendered DOM only — no builder markup assumptions.
 * The tree is what the generator emits as an Astro component; the snapshots
 * become its scoped CSS.
 */

import { STYLE_PROPS } from "./allowlist.mjs";
import { ACC_MARK, ACC_ITEM_MARK } from "../browser/disclose.mjs";

const MARK = "data-wpmig-n";

/**
 * Runs in the browser at the widest breakpoint. Builds the template tree and
 * stamps every retained element with a marker attribute so later passes (other
 * breakpoints, hover) can address the same nodes after a viewport resize.
 */
function BUILD_TREE({ selector, mark, accMark, itemMark }) {
  const root = document.querySelector(selector);
  if (!root) return { error: `no element matches: ${selector}` };

  const SKIP = new Set(["script", "style", "link", "template", "noscript", "meta"]);
  // Inline formatting allowed inside a text leaf. An <a> here is a text link;
  // an <a> wrapping block content is handled as a container instead.
  const INLINE_TEXT = new Set(["b", "strong", "i", "em", "u", "s", "sub", "sup", "br", "span", "small", "mark", "abbr", "a"]);
  const KEEP_ATTRS = ["href", "src", "alt", "title", "colspan", "rowspan", "target", "rel", "width", "height", "type", "name", "value", "placeholder", "action", "method", "for", "controls", "autoplay", "loop", "muted", "playsinline", "poster", "allow", "allowfullscreen", "frameborder", "datetime"];

  let counter = 0;

  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };

  const alphaOf = (color) => {
    const m = (color || "").match(/rgba?\(([^)]+)\)/);
    if (!m) return color && color !== "transparent" ? 1 : 0;
    const parts = m[1].split(",").map(parseFloat);
    return parts.length > 3 ? parts[3] : 1;
  };

  /** Does this element visually exist on its own? */
  const paints = (el) => {
    const cs = getComputedStyle(el);
    if (cs.backgroundImage !== "none") return true;
    if (alphaOf(cs.backgroundColor) > 0.02) return true;
    if (["Top", "Right", "Bottom", "Left"].some((s) => parseFloat(cs[`border${s}Width`]) > 0)) return true;
    if (cs.boxShadow !== "none") return true;
    for (const ps of ["::before", "::after"]) {
      const pcs = getComputedStyle(el, ps);
      if (pcs.content !== "none" && pcs.content !== "normal") return true;
    }
    return false;
  };

  /** A thin, empty, unfilled element whose paint is only a horizontal border —
   *  i.e. a horizontal rule / divider, not a decorative box. */
  const isRule = (el) => {
    const cs = getComputedStyle(el);
    const filled = cs.backgroundImage !== "none" || alphaOf(cs.backgroundColor) > 0.02;
    const hasLine = parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderBottomWidth) > 0;
    return !filled && hasLine && rect(el).h < 8;
  };

  const elementChildren = (el) => [...el.children].filter((c) => !SKIP.has(c.tagName.toLowerCase()));

  const hasOwnText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());

  /**
   * A wrapper that exists only to hold one child, paints nothing, and lets the
   * child fill its box carries no design meaning — builder scaffolding.
   * Geometry-only test: display:flex wrappers collapse fine (the old
   * class-aware toolkit refused them and hit a depth cliff on builder DOMs).
   */
  const isPassThrough = (el) => {
    if (paints(el)) return false;
    if (hasOwnText(el)) return false;
    const kids = elementChildren(el);
    if (kids.length !== 1) return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none") return false;
    if (cs.position !== "static" && cs.position !== "relative") return false;
    const pads = ["paddingTop", "paddingBottom", "paddingLeft", "paddingRight"].map((p) => parseFloat(cs[p]) || 0);
    if (Math.max(...pads) > 8) return false;
    // Margin is spacing this wrapper contributes, and collapsing it deletes
    // that spacing — which is how two buttons that sit apart in the source
    // ended up flush, each having lost its widget wrapper's margin.
    //
    // Scoped deliberately to wrappers around CONTROLS. Applying it to every
    // wrapper preserved so much extra scaffolding that repeat detection stopped
    // recognising its own items (a 15-item icon list came through as 13, and a
    // 7-card grid re-split into 3+3), because shape matching compares subtree
    // structure and the retained wrappers changed it. Controls are where the
    // lost spacing actually showed, so that is where the exception applies.
    const margins = ["marginTop", "marginBottom", "marginLeft", "marginRight"].map((p) => Math.abs(parseFloat(cs[p]) || 0));
    if (Math.max(...margins) > 4) {
      const holdsControl = kids[0] && (["a", "button"].includes(kids[0].tagName.toLowerCase()) || kids[0].querySelector("a,button"));
      if (holdsControl) return false;
    }
    const er = rect(el);
    const kr = rect(kids[0]);
    if (er.w <= 0 || er.h <= 0) return false;
    return (kr.w * kr.h) / (er.w * er.h) >= 0.92;
  };

  const isTextLeaf = (el) => {
    if (!(el.innerText || "").trim()) return false;

    // A wrapper whose entire content is a single anchor/button is not a text
    // leaf — it is a button *holder*, and treating it as text swallows the
    // control into a rich-text blob (losing its href, its measured styling and
    // any chance of an editable label). Builders emit exactly this shape:
    //   <div class="…button-wrapper"><a class="…button"><span><span>Text
    // The anchor is in INLINE_TEXT so the loop below would happily accept it.
    // Requiring the element to own some text of its own keeps genuine prose
    // like `<p>see <a>our team</a></p>` a leaf while letting a bare wrapper
    // descend to the control.
    const ownsText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!ownsText) {
      const controls = [...el.children].filter((c) => ["a", "button"].includes(c.tagName.toLowerCase()));
      // A button *row* is the same shape with more than one control, and the
      // first one is not necessarily the styled one — test them all, and treat
      // a wrapper whose children are nothing but controls as a holder either
      // way.
      if (controls.length && (controls.length === el.children.length || controls.some(isButtonish))) {
        return false;
      }
    }

    for (const c of el.children) {
      const t = c.tagName.toLowerCase();
      if (!INLINE_TEXT.has(t)) return false;
      if (c.querySelector("img,svg,iframe,video,picture,ul,ol,p,div,section,article,h1,h2,h3,h4,h5,h6,figure,table")) return false;
    }
    return true;
  };

  const isProseList = (el) => {
    const items = elementChildren(el);
    return items.length > 0 && items.every((li) => li.tagName.toLowerCase() === "li" && isTextLeaf(li));
  };

  const isButtonish = (el) => {
    const cs = getComputedStyle(el);
    const paints =
      alphaOf(cs.backgroundColor) > 0.02 ||
      ["Top", "Right", "Bottom", "Left"].some((s) => parseFloat(cs[`border${s}Width`]) > 0);
    if (!paints) return false;
    if (cs.display !== "inline") return true;
    // `display: inline` was treated as disqualifying, but plenty of themes
    // style a perfectly ordinary button without changing display — the padding
    // still gives it a box. What actually separates it from a prose link is
    // that a prose link has no horizontal padding, so test for that instead of
    // rejecting the whole display mode (which swallowed both hero CTAs into a
    // rich-text blob, losing their fill, border and measured geometry).
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    return padX >= 8;
  };

  /**
   * Recover the icon's *identity* before sanitisation throws classes away.
   *
   * An icon font renders its glyph from a class (`fad fa-check-circle`) via a
   * stylesheet rule, so once the class is gone the glyph is unrecoverable —
   * and where that stylesheet is a paid kit served from a CDN, shipping the
   * font was never an option anyway. Capturing the *name* lets generation
   * substitute the equivalent icon from the target project's own set, which is
   * portable and editable. Elementor's layout classes
   * (`elementor-icon-box-icon`) must not be mistaken for icon names.
   */
  const iconIdentity = (el) => {
    if (!el) return null;
    const tokens = (el.getAttribute("class") || "").split(/\s+/).filter(Boolean);
    let name = null;
    let family = null;
    for (const t of tokens) {
      if (/^fa[bdlrs]?$/i.test(t)) family = t.toLowerCase();
      else if (/^fa-.+/i.test(t)) name = t.replace(/^fa-/i, "");
      else if (/^eicon-.+/i.test(t)) name = t.replace(/^eicon-/i, "");
      else if (/^icon-.+/i.test(t) && !/^elementor/i.test(t)) name = t.replace(/^icon-/i, "");
    }
    return name ? { name, family } : null;
  };

  /**
   * Recover an embedded video before `data-*` attributes are stripped.
   *
   * A builder's video widget renders no <iframe> until its script runs — the
   * pre-JS DOM holds only a thumbnail div, with the real URL parked in a
   * `data-settings` JSON blob. Capturing computed styles alone therefore loses
   * the video entirely (this page's two YouTube embeds came through as one
   * empty box). Same category as icon glyphs: identity that lives in markup
   * rather than in rendered style, so it has to be read before sanitisation.
   */
  const videoIdentity = (el) => {
    // In a rendered (post-JS) snapshot the widget script has already mounted a
    // real <iframe>, which the tree walk keeps on its own — let it win rather
    // than promoting the wrapper to a competing embed from the stale data.
    if (el.querySelector?.("iframe")) return null;
    // ONLY the element that carries the attribute counts. Searching
    // descendants meant every ancestor up to the section root claimed the
    // video — and because an embed is a leaf kind, that aborted the walk and
    // collapsed the whole section into a single empty node.
    const holder = el.matches?.("[data-settings]") ? el : null;
    if (!holder) return null;
    let cfg;
    try {
      cfg = JSON.parse(holder.getAttribute("data-settings") || "{}");
    } catch {
      return null;
    }
    const url = cfg.youtube_url || cfg.vimeo_url || cfg.external_url || "";
    const yt = url.match(/(?:youtu\.be\/|[?&]v=|embed\/)([A-Za-z0-9_-]{6,})/);
    if (yt) return { provider: "youtube", id: yt[1] };
    const vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    if (vm) return { provider: "vimeo", id: vm[1] };
    return null;
  };

  const findIcon = (el) =>
    iconIdentity(el) || iconIdentity(el.querySelector("i,[class*='fa-'],[class*='eicon-']"));

  const keptAttrs = (el) => {
    const out = {};
    for (const a of el.attributes) {
      if (KEEP_ATTRS.includes(a.name) || a.name.startsWith("aria-") || a.name === "role") out[a.name] = a.value;
    }
    return out;
  };

  /** Deep-clone with every non-semantic attribute stripped — for rich-text/raw blobs. */
  const sanitizedHtml = (el, outer) => {
    const clone = el.cloneNode(true);
    const strip = (n) => {
      for (const a of [...n.attributes]) {
        if (!KEEP_ATTRS.includes(a.name) && !a.name.startsWith("aria-") && a.name !== "role") n.removeAttribute(a.name);
      }
      for (const c of [...n.children]) {
        if (SKIP.has(c.tagName.toLowerCase())) c.remove();
        else strip(c);
      }
    };
    strip(clone);
    return (outer ? clone.outerHTML : clone.innerHTML).trim();
  };

  const kindOf = (el, isRoot) => {
    const tag = el.tagName.toLowerCase();
    if (tag === "img") return "img";
    if (tag === "picture") return "img";
    if (tag === "hr") return "divider";
    if (tag === "svg") return "raw";
    if (tag === "iframe" || tag === "video" || tag === "audio") return "embed";
    if (tag === "form") return "raw";
    if (tag === "table") return "raw";
    if (/^h[1-6]$/.test(tag)) return "heading";
    if ((tag === "ul" || tag === "ol") && isProseList(el)) return "list";
    if ((tag === "a" || tag === "button") && isTextLeaf(el)) return isButtonish(el) ? "button" : "textlink";
    if (!isRoot && isTextLeaf(el)) return "text";
    const kids = elementChildren(el);
    if (kids.length === 0 && !(el.innerText || "").trim()) {
      // A thin, empty, unfilled element whose only paint is a top/bottom border
      // is a horizontal rule — an <hr> or a page-builder "divider" widget. Catch
      // it BEFORE the generic `decor` branch (which would render it as an empty
      // box and lose the line) so it emits as a real <hr>.
      if (isRule(el)) return "divider";
      if (paints(el)) return "decor";
      return rect(el).h >= 8 ? "spacer" : "drop";
    }
    return "container";
  };

  const build = (el, isRoot) => {
    const tag0 = el.tagName.toLowerCase();
    if (SKIP.has(tag0)) return null;

    const cs = getComputedStyle(el);
    const hidden = cs.display === "none" || cs.visibility === "hidden";
    // Hidden nodes are kept only if they hold content — they may be a
    // responsive alternate that appears at another breakpoint.
    if (hidden && !(el.innerText || "").trim() && !el.querySelector("img,iframe,svg,video")) return null;

    // Collapse builder scaffolding (never the section root itself).
    let node = el;
    let guard = 0;
    // The video's `data-settings` lives on the widget wrapper, which is itself
    // a textbook pass-through (one child, no paint) and so gets collapsed away.
    // Collect the identity along the chain rather than after it, or the
    // attribute is gone by the time we look.
    let video = videoIdentity(el);
    // When this element IS the video widget, it becomes the embed — keep it
    // rather than collapsing into its inner container, so its own box (and the
    // margin that separates stacked videos) survives. Same failure as the
    // button wrappers: collapsing a wrapper deletes the spacing it contributes.
    while (!isRoot && !hidden && !video && isPassThrough(node) && guard++ < 12) {
      const only = elementChildren(node)[0];
      const k = kindOf(only, false);
      // Never collapse *past* content — a heading whose text sits in a span
      // passes the geometry test, and descending into it would discard it.
      if (k !== "container") break;
      node = only;
      video = video || videoIdentity(node);
    }

    const tag = node.tagName.toLowerCase();
    let kind = kindOf(node, isRoot);

    // A pre-JS video widget is an empty div and would otherwise be dropped as
    // noise, taking the embed with it. Promote it to a real embed.
    if (video) kind = "embed";

    if (kind === "drop") return null;

    const n = counter++;
    node.setAttribute(mark, String(n));

    const rec = {
      n,
      tag,
      kind,
      hidden,
      attrs: keptAttrs(node),
      box: rect(node),
      children: [],
    };

    const icon = findIcon(node);
    if (icon) rec.icon = icon;
    if (video) rec.video = video;

    if (kind === "heading" || kind === "text" || kind === "button" || kind === "textlink") {
      rec.text = (node.innerText || "").replace(/\s+/g, " ").trim();
      rec.html = sanitizedHtml(node, false);
    } else if (kind === "list" || kind === "raw") {
      rec.html = sanitizedHtml(node, true);
      rec.text = (node.innerText || "").replace(/\s+/g, " ").trim().slice(0, 200);
    } else if (kind === "img") {
      const img = tag === "img" ? node : node.querySelector("img");
      if (img) {
        rec.attrs = keptAttrs(img);
        rec.attrs.src = img.getAttribute("src") || "";
        delete rec.attrs.srcset;
        if (img !== node) img.setAttribute(mark, String(n));
      }
    }

    if (kind === "container") {
      for (const c of elementChildren(node)) {
        const child = build(c, false);
        if (child) rec.children.push(child);
      }
      // A container that lost all its children to pruning is itself noise
      // unless it paints (divider, decorative band).
      if (rec.children.length === 0 && !(node.innerText || "").trim()) {
        if (!paints(node)) return null;
        rec.kind = "decor";
      }
    }

    return rec;
  };

  // Rotation is behaviour, not style: it lives in JS that the captured DOM
  // cannot express. Record that the source rotates so generation can route the
  // section to a component that actually implements it, rather than emitting a
  // static strip of every slide.
  // Match a slider's ROOT container, not any element that merely mentions
  // "slider" or "carousel" somewhere in its class list. The loose version
  // matched an incidental nested class inside a bespoke content section and
  // rerouted a whole prose-and-photo section to a logo strip.
  const CAROUSEL_ROOT = /\b(swiper|swiper-container|slick-slider|owl-carousel|flickity-enabled|splide__track|glide__track|elementor-image-carousel|elementor-slides)\b/i;
  const carousel = CAROUSEL_ROOT.test(root.className || "") ||
    [...root.querySelectorAll("*")].some((el) => CAROUSEL_ROOT.test(el.getAttribute("class") || ""));

  const tree = build(root, true);
  if (tree) {
    tree.kind = "container";
    tree.isRoot = true;
  }

  // Accordions were recognised, measured and opened before segmentation ran —
  // see `src/browser/disclose.mjs` for why both had to happen there. All that
  // is left here is to say which *captured nodes* each one occupies, so the
  // generator can lift the accordion out of its section and route the rest of
  // the section normally. Marks only exist after `build`, hence the position.
  const accordions = [];
  // `root` is included because `querySelectorAll` never returns the element it
  // is called on, and a section root can itself be the accordion. That makes a
  // duplicate possible whenever both reach the same element, and a duplicate
  // here emits the whole widget twice on the page — so dedupe on identity.
  const accRoots = [...new Set([root, ...root.querySelectorAll(`[${accMark}]`)])].filter((el) =>
    el.hasAttribute(accMark)
  );
  for (const el of accRoots) {
    const stored = (window.__wpmigAccordions || [])[Number(el.getAttribute(accMark))];
    if (!stored) continue;
    const nodes = new Set();
    // The *items*, not the root: a generic `<details>` accordion's "root" is
    // merely the parent its panels happen to share, and claiming that parent
    // would prune sibling content that has nothing to do with the accordion.
    for (const host of el.querySelectorAll(`[${itemMark}]`)) {
      const own = host.getAttribute(mark);
      if (own !== null) nodes.add(Number(own));
      for (const inner of host.querySelectorAll(`[${mark}]`)) nodes.add(Number(inner.getAttribute(mark)));
    }
    if (!nodes.size) continue;
    const list = [...nodes].sort((a, b) => a - b);
    accordions.push({ ...stored, nodes: list, minN: list[0], maxN: list[list.length - 1] });
  }

  return { tree, carousel, accordions, pageTitle: document.title };
}

/**
 * Runs in the browser at each breakpoint: read the allowlisted computed styles
 * (plus ::before/::after and geometry) of every marked node.
 */
function READ_STYLES({ props, mark, accMark }) {
  const out = {};
  for (const el of document.querySelectorAll(`[${mark}]`)) {
    const n = el.getAttribute(mark);
    const cs = getComputedStyle(el);
    const styles = {};
    for (const p of props) styles[p] = cs[p];
    const r = el.getBoundingClientRect();
    const rec = {
      styles,
      box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      visible: cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0,
    };
    // Every measurement here is taken with the disclosures forced open, which
    // is necessary to read their content and ruinous for their geometry: on
    // this site an accordion goes 869px -> 5137px, so any ancestor's height is
    // several times what a visitor ever sees. Flag those boxes rather than
    // trying to correct them — a consumer that wants layout (an authored band's
    // min-height) must not bake this number, while one that wants content is
    // unaffected. `h` stays as measured; only its trustworthiness is recorded.
    if (accMark && (el.hasAttribute(accMark) || el.querySelector(`[${accMark}]`))) {
      rec.heightInflated = true;
    }
    for (const [ps, key] of [["::before", "before"], ["::after", "after"]]) {
      const pcs = getComputedStyle(el, ps);
      if (pcs.content !== "none" && pcs.content !== "normal" && pcs.content !== "") {
        const pstyles = { content: pcs.content, inset: pcs.inset, pointerEvents: pcs.pointerEvents };
        for (const p of props) pstyles[p] = pcs[p];

        // A pseudo-element whose content is empty is pure paint, so its box IS
        // the design — a `h2::after` divider is nothing but `display: block`
        // and a 1px height. `width`/`height` are left out of STYLE_PROPS on
        // purpose (a computed width on a real node is a used value, not an
        // authored one), but a pseudo has no content to be sized by, so here
        // they are the authored value. A width that fills the host is recorded
        // as `100%` rather than the pixel it happened to measure.
        const host = parseFloat(cs.width) - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        const w = parseFloat(pcs.width);
        pstyles.width = Number.isFinite(w) && Number.isFinite(host) && Math.abs(w - host) <= 1
          ? "100%"
          : pcs.width;
        pstyles.height = pcs.height;
        rec[key] = pstyles;
      }
    }
    const parent = el.parentElement ? el.parentElement.closest(`[${mark}]`) : null;
    rec.parent = parent ? parent.getAttribute(mark) : null;
    out[n] = rec;
  }
  return out;
}

/** Runs in the browser: UA default styles per tag, from a pristine iframe. */
function READ_DEFAULTS({ props, tags }) {
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:absolute;left:-10000px;width:1200px;height:800px";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  const out = {};
  for (const tag of tags) {
    let el;
    try {
      el = doc.createElement(tag);
    } catch {
      continue;
    }
    if (tag === "a") el.setAttribute("href", "#");
    el.appendChild(doc.createTextNode("x"));
    doc.body.appendChild(el);
    const cs = frame.contentWindow.getComputedStyle(el);
    const styles = {};
    for (const p of props) styles[p] = cs[p];
    out[tag] = styles;
    el.remove();
  }
  frame.remove();
  return out;
}

function collectTags(tree, set = new Set()) {
  set.add(tree.tag);
  for (const c of tree.children || []) collectTags(c, set);
  return set;
}

function collectNodes(tree, list = []) {
  list.push(tree);
  for (const c of tree.children || []) collectNodes(c, list);
  return list;
}

async function settle(page) {
  await page.evaluate(() => document.fonts?.ready?.catch?.(() => {}) ?? null).catch(() => {});
  await page.waitForTimeout(350);
}

/**
 * Force :hover on one node via CDP and read the resulting styles of its whole
 * subtree. Pseudo-class state can't be reached from script; the devtools
 * protocol is the only reliable way in.
 */
async function captureHover(page, cdp, n, props) {
  const { root } = await cdp.send("DOM.getDocument", { depth: 1 });
  const { nodeId } = await cdp.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: `[${MARK}="${n}"]`,
  });
  if (!nodeId) return null;

  await cdp.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: ["hover"] });
  await page.waitForTimeout(120);
  const hovered = await page.evaluate(
    ({ props, mark, n }) => {
      const rootEl = document.querySelector(`[${mark}="${n}"]`);
      if (!rootEl) return null;
      const out = {};
      const read = (el) => {
        const id = el.getAttribute(mark);
        if (id !== null) {
          const cs = getComputedStyle(el);
          const styles = {};
          for (const p of props) styles[p] = cs[p];
          out[id] = styles;
        }
        for (const c of el.children) read(c);
      };
      read(rootEl);
      return out;
    },
    { props, mark: MARK, n }
  );
  await cdp.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: [] });
  return hovered;
}

/**
 * Capture one section.
 *
 * @param page       Playwright page, already navigated and settled, at the widest breakpoint.
 * @param selector   CSS selector for the section root.
 * @param opts       { breakpoints: number[] (descending widths), hoverNodes: (tree) => n[] }
 */
export async function captureSection(page, selector, opts = {}) {
  const breakpoints = [...(opts.breakpoints || [1280, 768, 390])].sort((a, b) => b - a);
  const props = STYLE_PROPS;

  const built = await page.evaluate(BUILD_TREE, { selector, mark: MARK, accMark: ACC_MARK, itemMark: ACC_ITEM_MARK });
  if (built.error) throw new Error(built.error);
  const { tree, carousel, accordions } = built;
  if (!tree) throw new Error(`section at ${selector} produced an empty tree`);

  // In-page anchor targets the author wired to their own nav are section
  // boundaries the geometry cannot see (see `splitByAnchors`). Map each one
  // that falls *inside* this section to the node number its content begins at —
  // the anchor element is often a collapsed wrapper, so its first marked
  // descendant is the real boundary node.
  const anchors = opts.anchorIds?.length
    ? await page.evaluate(
        ({ selector, ids, mark }) => {
          const root = document.querySelector(selector);
          if (!root) return [];
          const out = [];
          for (const id of ids) {
            const el = document.getElementById(id);
            if (!el || el === root || !root.contains(el)) continue;
            const marked = el.hasAttribute(mark) ? el : el.querySelector(`[${mark}]`);
            if (marked) out.push(Number(marked.getAttribute(mark)));
          }
          return out;
        },
        { selector, ids: opts.anchorIds, mark: MARK }
      )
    : [];

  const defaults = await page.evaluate(READ_DEFAULTS, { props, tags: [...collectTags(tree)] });

  const styles = {};
  for (const bp of breakpoints) {
    await page.setViewportSize({ width: bp, height: 940 });
    await settle(page);
    await page
      .evaluate((mark) => {
        document.querySelector(`[${mark}="0"]`)?.scrollIntoView({ block: "start" });
      }, MARK)
      .catch(() => {});
    await page.waitForTimeout(150);
    styles[bp] = await page.evaluate(READ_STYLES, { props, mark: MARK, accMark: ACC_MARK });
  }

  // Hover pass at the widest breakpoint.
  await page.setViewportSize({ width: breakpoints[0], height: 940 });
  await settle(page);

  const hover = {};
  const hoverTargets =
    opts.hoverNodes?.(tree) ??
    collectNodes(tree)
      .filter((node) => ["a", "button"].includes(node.tag) && !node.hidden)
      .map((node) => node.n);

  let cdp = null;
  if (hoverTargets.length) {
    cdp = await page.context().newCDPSession(page);
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    for (const n of hoverTargets) {
      try {
        const result = await captureHover(page, cdp, n, props);
        if (result) hover[n] = result;
      } catch {
        // Hover fidelity is best-effort; a failed node just loses its hover rules.
      }
    }
    await cdp.detach().catch(() => {});
  }

  return { tree, styles, hover, defaults, breakpoints, carousel, accordions, anchors };
}

export { MARK };
