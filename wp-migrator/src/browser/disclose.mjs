/**
 * Disclosure widgets: open them, and measure them on the way past.
 *
 * A closed `<details>` contributes *nothing* to a capture. Chrome renders no
 * box for its subtree and `innerText` returns `""`, so `BUILD_TREE`'s text
 * tests all fail and the pruning pass deletes the panel as noise. Captured
 * as-is, this site's New Patients page yields **one of fourteen** FAQ answers —
 * the single panel Elementor server-renders `open` — and loses the caption
 * under every video in the eight closed panels of its video accordion. The
 * content is not being flattened, it is being lost, so nothing downstream can
 * recover it: the panels have to be open before segmentation runs.
 *
 * Opening them destroys the other half of the design, though. An accordion's
 * whole visual language is the difference between a closed title bar and the
 * open one (here: `#f4f8f7` on dark, vs brand blue on white), and once every
 * panel is open the closed state is unmeasurable. So this module reads both
 * states first and only then opens everything — it is the one place in the
 * pipeline that sees both.
 *
 * What it leaves behind for the capture pass: a `data-wpmig-acc` index on each
 * accordion root, and `window.__wpmigAccordions` holding that accordion's theme
 * and its title/panel content. `src/capture/section.mjs` picks both up while
 * building the template tree, so the class-name vocabulary for "what is an
 * accordion" lives here and only here.
 */

export const ACC_MARK = "data-wpmig-acc";
/** Stamped on the elements one accordion *item* occupies: "<accordion>.<item>". */
export const ACC_ITEM_MARK = "data-wpmig-acc-item";

/**
 * Runs in the browser. Returns counts for logging; the payload itself stays on
 * `window.__wpmigAccordions`, where BUILD_TREE reads it in the same context
 * rather than shipping it through Node and back.
 */
function DISCLOSE({ accMark, itemMark }) {
  const ROOT_CLASS =
    /\b(e-n-accordion|elementor-accordion|elementor-toggle|elementor-tabs|fusion-accordian|accordian)\b/i;
  const ICON_SEL = "svg, i, [class*='icon'], [class*='eicon']";

  // Attributes worth keeping in a panel's rich text. Deliberately narrower than
  // the tree capture's list — this is prose, not a measured component.
  const KEEP_ATTRS = [
    "href", "src", "alt", "title", "colspan", "rowspan", "target", "rel", "width", "height",
    "type", "controls", "poster", "preload", "datetime", "start", "reversed",
  ];

  const cs = (el) => getComputedStyle(el);

  /**
   * An accordion root. Either a builder's own container, or — for a theme this
   * tool has never seen — any element holding native `<details><summary>`
   * children directly. The second test is what keeps this working past
   * Elementor; the first is what catches the builders that reimplement
   * disclosure with divs and JS.
   */
  const roots = [];
  const claim = (el) => {
    if (!el || roots.some((r) => r === el || r.contains(el) || el.contains(r))) return;
    roots.push(el);
  };
  for (const el of document.querySelectorAll("*")) {
    if (ROOT_CLASS.test(el.getAttribute("class") || "")) claim(el);
  }
  for (const d of document.querySelectorAll("details > summary")) {
    claim(d.parentElement?.parentElement);
  }

  /** The title/panel pairs of one root, in document order. */
  const itemsOf = (root) => {
    const out = [];
    for (const d of root.querySelectorAll("details")) {
      const summary = d.querySelector(":scope > summary");
      if (!summary) continue;
      const panels = [...d.children].filter((c) => c !== summary);
      out.push({ titleEl: summary, panelEls: panels, isOpen: d.open, hostEls: [d] });
    }
    if (out.length) return out;
    // Avada / Fusion Builder: `.fusion-panel` wraps a `.panel-title` bar and a
    // `.panel-collapse` body, with the body's own `.toggle-content` holding the
    // prose. The bar is an `<a>` inside the title, and "open" is Bootstrap's
    // `.in` on the collapse (Avada is built on Bootstrap's collapse).
    for (const panel of root.querySelectorAll(".fusion-panel")) {
      const title = panel.querySelector(".panel-title");
      const body = panel.querySelector(".panel-collapse, .toggle-content");
      if (!title || !body) continue;
      const open =
        /\bin\b/.test(body.getAttribute("class") || "") || cs(body).display !== "none";
      out.push({ titleEl: title, panelEls: [body], isOpen: open, hostEls: [panel] });
    }
    if (out.length) return out;
    // Legacy Elementor: a title div followed by its content div as siblings.
    const titles = root.querySelectorAll(".elementor-tab-title, .elementor-toggle-title");
    for (const t of titles) {
      const panel = t.nextElementSibling;
      if (!panel || !/elementor-(tab|toggle)-content/.test(panel.getAttribute("class") || "")) continue;
      const open = /elementor-active/.test(t.getAttribute("class") || "") || cs(panel).display !== "none";
      out.push({ titleEl: t, panelEls: [panel], isOpen: open, hostEls: [t, panel] });
    }
    return out;
  };

  /** Read the design off one closed title bar and one open one. */
  const themeOf = (root, items) => {
    const open = items.find((i) => i.isOpen) ?? items[0];
    const closed = items.find((i) => !i.isOpen) ?? items[0];
    if (!open || !closed) return null;
    const o = cs(open.titleEl);
    const c = cs(closed.titleEl);
    const item = cs(closed.hostEls[0]);
    const panel = open.panelEls[0] ? cs(open.panelEls[0]) : null;
    /** One side of a border as a shorthand, or "0" where there is none. */
    const side = (style, name) =>
      style && parseFloat(style[`border${name}Width`]) > 0
        ? `${style[`border${name}Width`]} ${style[`border${name}Style`]} ${style[`border${name}Color`]}`
        : "0";
    const SIDES = ["Top", "Right", "Bottom", "Left"];
    return {
      titleBackground: c.backgroundColor,
      titleColor: c.color,
      titleBackgroundOpen: o.backgroundColor,
      titleColorOpen: o.color,
      titleFontSize: c.fontSize,
      titleFontWeight: c.fontWeight,
      titlePadding: c.padding,
      titleGap: c.columnGap && c.columnGap !== "normal" ? c.columnGap : "",
      itemGap: item.marginBottom,
      // Emitted even when it is "0": the target's own accordion separates its
      // items with a hairline rule, and a source that separates them with a gap
      // instead has to say so, or it gets both.
      itemBorder: SIDES.map((n) => side(item, n)).every((v) => v === "0")
        ? "0"
        : side(item, "Bottom"),
      detailPadding: panel ? panel.padding : "",
      // All four sides. The source's open panel is a bordered card, and reading
      // only the top and bottom turns it into a pair of loose rules.
      ...Object.fromEntries(SIDES.map((n) => [`detailBorder${n}`, side(panel, n)])),
      hasIcon: Boolean(open.titleEl.querySelector(ICON_SEL)),
    };
  };

  /** Deep clone with the noise stripped, for a panel's rich text. */
  const sanitized = (el) => {
    const clone = el.cloneNode(true);
    const strip = (n) => {
      for (const a of [...n.attributes]) {
        if (a.name === "style") {
          // Alignment and list markers are authored content; everything else a
          // builder inlines is layout scaffolding for a DOM we are not keeping.
          const keep = a.value.match(/(text-align|list-style[a-z-]*)\s*:\s*[^;]+/gi);
          if (keep) n.setAttribute("style", `${keep.join("; ")};`);
          else n.removeAttribute("style");
          continue;
        }
        if (!KEEP_ATTRS.includes(a.name)) n.removeAttribute(a.name);
      }
      for (const c of [...n.children]) {
        if (["script", "style", "link", "template", "noscript"].includes(c.tagName.toLowerCase())) c.remove();
        else strip(c);
      }
    };
    strip(clone);
    return clone.outerHTML.trim();
  };

  const WRAPPER = new Set(["div", "section", "article", "main", "aside", "header", "footer"]);
  const MEDIA = new Set(["video", "audio", "iframe", "img", "picture", "embed", "object"]);

  /**
   * Split a panel into an ordered run of rich text and media.
   *
   * The template tree cannot do this job: an Elementor list is a `<ul>` whose
   * `<li>`s wrap `<div>`s, which classifies as a plain container and therefore
   * carries no html of its own — merging its leaf text back together would
   * emit ten paragraphs where the source has one list. Reading the panel's own
   * markup keeps the list, the bolding and the links intact, and splitting only
   * at media lets each video become a real component instead of a raw tag
   * buried in a rich-text blob.
   */
  /**
   * A container laying its children out ACROSS rather than down.
   *
   * The video accordion's panels are three-across rows of caption-and-clip.
   * Flattened into one stream of blocks they render as a tall column of small
   * videos — the content all present and the layout nothing like the source —
   * so a row is kept as a row and becomes a grid in the target.
   *
   * Read from geometry, not from class names: two children that share a
   * horizontal band and sit at different x are a row whatever produced them.
   */
  const rowColumns = (el) => {
    const style = cs(el);
    if (style.display !== "flex" && style.display !== "grid" && style.display !== "inline-flex") return null;
    if (style.display !== "grid" && !style.flexDirection.startsWith("row")) return null;
    const kids = [...el.children].filter((k) => !["script", "style", "link", "template", "noscript"].includes(k.tagName.toLowerCase()));
    if (kids.length < 2) return null;
    const boxes = kids.map((k) => k.getBoundingClientRect());
    const sideBySide = boxes.some((a, i) =>
      boxes.some((b, j) => j !== i && Math.abs(a.top - b.top) < 8 && Math.abs(a.left - b.left) > 8)
    );
    return sideBySide ? kids : null;
  };

  const segmentsOf = (panelEls) => {
    const segments = [];
    let buf = "";
    // The alignment of the first element in the run. A caption centred over its
    // video is centred by an Elementor class, not by an inline style, so it is
    // invisible to the markup and has to be read off the computed style.
    let bufAlign = "";
    const flush = () => {
      if (buf.replace(/<[^>]*>/g, "").trim() || /<(img|video|iframe|hr)\b/i.test(buf)) {
        segments.push({ type: "html", html: buf.trim(), align: bufAlign });
      }
      buf = "";
      bufAlign = "";
    };
    const visit = (el) => {
      const tag = el.tagName.toLowerCase();
      if (MEDIA.has(tag)) {
        flush();
        if (tag === "video" || tag === "audio") {
          const src = el.getAttribute("src") || el.querySelector("source")?.getAttribute("src") || "";
          segments.push({ type: "video", src, poster: el.getAttribute("poster") || "", title: "" });
        } else if (tag === "iframe" || tag === "embed" || tag === "object") {
          segments.push({ type: "embed", html: sanitized(el) });
        } else {
          const img = tag === "img" ? el : el.querySelector("img");
          segments.push({ type: "image", src: img?.getAttribute("src") || "", alt: img?.getAttribute("alt") || "" });
        }
        return;
      }
      // A wrapper with no text of its own is builder scaffolding: contribute
      // nothing, descend. This is what unwraps `.elementor-element >
      // .elementor-widget-container` down to the real <p> and <ul>.
      const ownsText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (WRAPPER.has(tag) && !ownsText && el.children.length) {
        const columns = rowColumns(el);
        if (columns) {
          flush();
          segments.push({
            type: "row",
            // The count, not a pixel width. A width only reproduces the layout
            // at the viewport it was measured at — capture runs at the widest
            // breakpoint, and the same panel rendered in a narrower container
            // would quietly drop to two across.
            columnCount: columns.length,
            columns: columns.map((column) => segmentsOf([column])),
          });
          return;
        }
        for (const c of [...el.children]) visit(c);
        return;
      }
      if (!buf) bufAlign = cs(el).textAlign;
      buf += sanitized(el);
    };
    for (const panel of panelEls) visit(panel);
    flush();
    return segments;
  };

  const titleOf = (el) => {
    const clone = el.cloneNode(true);
    for (const icon of clone.querySelectorAll(ICON_SEL)) icon.remove();
    return (clone.textContent || "").replace(/\s+/g, " ").trim();
  };

  // --- pass 1, closed: the design -----------------------------------------
  // Only the *closed* state can be read now, and only from here — once the
  // panels are open there is no way back to it.
  const found = [];
  for (const root of roots) {
    const items = itemsOf(root);
    if (!items.length) continue;
    const index = found.length;
    root.setAttribute(accMark, String(index));
    // Stamp the elements each item actually occupies, not just the root: a
    // generic `<details>` root is only the *parent* of its panels, and pruning
    // the whole parent out of a section would take unrelated content with it.
    items.forEach((it, i) => {
      for (const host of it.hostEls) host.setAttribute(itemMark, `${index}.${i}`);
    });
    // The closed height, measured while it still exists. Opening the panels is
    // necessary (a closed panel captures as empty) but it inflates the
    // accordion — and every ancestor — several times over, and *that* is the
    // geometry segmentation and the CSS emitter go on to measure. Recording it
    // here is the only chance: afterwards the closed layout is unrecoverable.
    found.push({
      root,
      items,
      theme: themeOf(root, items),
      openFirst: items[0]?.isOpen ?? false,
      closedHeight: Math.round(root.getBoundingClientRect().height),
    });
  }

  // Only now is it safe to open. A `name` attribute makes a group exclusive, so
  // setting `open` on each in turn would close the one before it.
  let opened = 0;
  for (const d of document.querySelectorAll("details")) {
    if (d.hasAttribute("name")) d.removeAttribute("name");
    if (!d.open) {
      d.open = true;
      opened++;
    }
  }
  for (const el of document.querySelectorAll(
    ".elementor-tab-content, .elementor-toggle-content, .e-n-tabs-content > *, [role='tabpanel']"
  )) {
    if (el.hasAttribute("hidden")) el.removeAttribute("hidden");
    if (getComputedStyle(el).display === "none") {
      el.style.setProperty("display", "block", "important");
      opened++;
    }
  }
  // Avada / Fusion Builder rides on Bootstrap's collapse: the body carries
  // `.collapse` and is shown by adding `.in`, with height animated inline.
  // Clearing that inline height matters as much as the class — Bootstrap
  // leaves `height: 0px` behind on a panel it has closed.
  for (const el of document.querySelectorAll(".fusion-panel .panel-collapse")) {
    const wasClosed = !/\bin\b/.test(el.getAttribute("class") || "");
    el.classList.add("in");
    el.classList.remove("collapsing");
    el.style.removeProperty("height");
    if (getComputedStyle(el).display === "none") {
      el.style.setProperty("display", "block", "important");
    }
    if (wasClosed) opened++;
  }

  // --- pass 2, open: the content -------------------------------------------
  // Deliberately after the opening. A closed panel has no boxes, so a row of
  // three videos measures as three zero-width elements at the same point and
  // reads as a stack — the content would survive and its layout would not.
  const accordions = found.map((accordion) => ({
    theme: accordion.theme,
    openFirst: accordion.openFirst,
    closedHeight: accordion.closedHeight,
    openHeight: Math.round(accordion.root.getBoundingClientRect().height),
    items: accordion.items.map((it) => ({ title: titleOf(it.titleEl), segments: segmentsOf(it.panelEls) })),
  }));
  window.__wpmigAccordions = accordions;

  return {
    opened,
    accordions: accordions.length,
    panels: accordions.reduce((n, a) => n + a.items.length, 0),
    // Sizes travel back to Node separately from `window.__wpmigAccordions`,
    // which the capture pass reads in-page for content.
    accordionSizes: accordions.map((a) => ({ closedHeight: a.closedHeight, openHeight: a.openHeight })),
  };
}

/**
 * Measure and then open every disclosure widget on the page.
 *
 * Call once per page, after overlay suppression and *before* segmentation —
 * a closed panel captures as empty, so the content has to be revealed before
 * anything downstream reads it.
 *
 * The cost is that everything after this measures an *inflated* page: on this
 * site one section went from 1,419px closed to 5,303px open and another from
 * 2,398px to 13,177px, and those numbers are what segmentation and the CSS
 * emitter then bake. So each accordion reports `closedHeight` alongside
 * `openHeight`, and callers that care about layout (rather than content) use
 * the difference to discount the inflation — see `disclosureInflation`.
 */
export async function expandDisclosures(page) {
  const result = await page.evaluate(DISCLOSE, { accMark: ACC_MARK, itemMark: ACC_ITEM_MARK });
  if (result.opened) await page.waitForTimeout(400);
  return result;
}

/**
 * How much taller opening the disclosures made the page, in px.
 *
 * A section containing an accordion is not "that tall" in any rendering a
 * visitor ever sees; it is that tall only because we opened it to read it. Any
 * measurement meant to describe the *design* — a section's height, an authored
 * band's `min-height` — has to be read with this discounted, or the page is
 * rebuilt around a number that never existed.
 */
export function disclosureInflation(result) {
  return (result?.accordionSizes ?? []).reduce(
    (n, a) => n + Math.max(0, (a.openHeight ?? 0) - (a.closedHeight ?? 0)),
    0
  );
}
