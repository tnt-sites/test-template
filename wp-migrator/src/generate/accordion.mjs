/**
 * An accordion is behaviour, and behaviour cannot be reconstructed from a
 * captured DOM.
 *
 * The same trade as the carousel path in `bin/wpmig.mjs`: where the target
 * already implements the behaviour, reuse it and hand it the harvested content
 * and the measured design, rather than forking a bespoke component that renders
 * every panel open at once. Here the target is
 * `page-sections/info-blocks/faq-section`, which wraps
 * `building-blocks/wrappers/accordion`; its `accordion-item` takes a
 * `contentSections[]` array, so a panel is not limited to prose — the video
 * accordion's panels come through as real `core-elements/video` blocks.
 *
 * What this module does NOT do is decide what an accordion is or what is inside
 * one. That is all read from the live DOM in `src/browser/disclose.mjs`, which
 * is the only pass that sees a panel both closed (where the design lives) and
 * open (where the content lives). Everything here is a pure transform of what
 * it captured, so it is testable without a browser.
 */

import { hexifyCss, nearestOption, toHex } from "./color-palette.mjs";

/** The target's building blocks, by the ref `renderBlock.astro` resolves. */
const TEXT = "building-blocks/core-elements/text";
const VIDEO = "building-blocks/core-elements/video";
const IMAGE = "building-blocks/core-elements/image";
const EMBED = "building-blocks/core-elements/embed";
const GRID = "building-blocks/wrappers/grid";
const GRID_ITEM = "building-blocks/wrappers/grid/grid-item";
export const ACCORDION_ITEM = "building-blocks/wrappers/accordion/accordion-item";

/**
 * Give a media URL a scheme.
 *
 * The mirror hands these back in three forms — `https://video.prosites.com/…`,
 * protocol-relative `//video.prosites.com/…`, and (where the mirror rewriter
 * has been at it) a bare `video.prosites.com/…`. Only the first works in a
 * `<source src>`; the third resolves against the page and 404s as a relative
 * path, silently, with the poster still showing.
 */
export function normalizeMediaUrl(src) {
  const value = (src || "").trim();
  if (!value) return "";
  if (/^(https?:|data:|blob:)/i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  if (value.startsWith("/")) return value;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+\//i.test(value) ? `https://${value}` : value;
}

const collapse = (html) => (html || "").replace(/\s+/g, " ").replace(/>\s+</g, "><").trim();

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

/** Plain text of an html fragment, for the short-label test. */
const textOf = (html) =>
  (html || "")
    .replace(/<[^>]*>/g, " ")
    // A caption lifted out of markup and back into a plain string prop has to
    // come with it: "Brushing &amp; Flossing" is not what the source says.
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m, name) => ENTITIES[name])
    .replace(/\s+/g, " ")
    .trim();

/** A wrapper holding nothing but a caption is a label, not a paragraph. */
const isShortLabel = (segment) =>
  segment?.type === "html" &&
  !/<(p|ul|ol|table|h[1-6]|blockquote|figure)\b/i.test(segment.html) &&
  textOf(segment.html).length > 0 &&
  textOf(segment.html).length < 80;

/**
 * One panel's segments as the `contentSections` array `AccordionItem` renders.
 *
 * `rewriteHtml` is `props.mjs`'s link repair, threaded in rather than imported
 * so this module stays free of the capture-time route map.
 */
export function segmentsToSections(segments = [], { rewriteHtml = (h) => h } = {}) {
  const out = [];
  segments.forEach((segment, i) => {
    if (segment.type === "row") {
      // A row of panel content becomes a grid rather than a stack. The source's
      // video panels are three-across; flattened they render as a tall column
      // of small clips — every video present and the layout nothing like it.
      const items = segment.columns
        .map((column) => segmentsToSections(column, { rewriteHtml }))
        .filter((sections) => sections.length)
        .map((sections) => ({ _component: GRID_ITEM, contentSections: sections }));
      if (!items.length) return;
      // `layout: start` and not `center`, deliberately. Both are the same
      // component; `center` asks for `display: flex` on a `.grid`, and the
      // target's Tailwind `utilities` layer defines `.grid { display: grid }`
      // after the `components` layer that holds it — so `center` loses the
      // cascade and collapses its items to zero width. `start` wants grid
      // anyway, so the collision is a no-op there.
      out.push({
        _component: GRID,
        id: "",
        label: "",
        layout: "start",
        // The measured count, so the panel is three across wherever it renders
        // rather than only at the width it was captured at. `minItemWidth` is
        // the floor the columns may shrink to before wrapping.
        columns: items.length,
        minItemWidth: 180,
        maxItemWidth: 480,
        items,
        gap: "md",
      });
      return;
    }
    if (segment.type === "video") {
      const source = normalizeMediaUrl(segment.src);
      if (!source) return;
      // The caption sits in its own text widget ahead of the video. `type:
      // hosted` renders a bare <video>, which shows no title, so the label is
      // kept as its own block AND copied onto the video — the first is what the
      // reader sees, the second is what names it in the CloudCannon editor.
      const label = isShortLabel(segments[i - 1]) ? textOf(segments[i - 1].html) : segment.title || "";
      out.push({
        _component: VIDEO,
        id: "",
        type: "hosted",
        title: label,
        source,
        thumbnail: normalizeMediaUrl(segment.poster),
      });
      return;
    }
    if (segment.type === "image") {
      const source = normalizeMediaUrl(segment.src);
      if (source) out.push({ _component: IMAGE, id: "", source, alt: segment.alt || "" });
      return;
    }
    if (segment.type === "embed") {
      out.push({ _component: EMBED, id: "", html: rewriteHtml(collapse(segment.html)), aspectRatio: "landscape" });
      return;
    }
    const html = rewriteHtml(collapse(segment.html));
    if (textOf(html) || /<(img|video|iframe|hr)\b/i.test(html)) {
      out.push({ _component: TEXT, id: "", text: html, alignX: alignOf(segment.align) });
    }
  });
  return out;
}

/** A computed `text-align` as the target's own alignment vocabulary. */
const alignOf = (value) => {
  if (value === "center") return "center";
  if (value === "right" || value === "end") return "end";
  return "start";
};

/** A measured colour as a palette token where one matches, else a literal. */
function colorValue(value, branding) {
  const raw = (value || "").trim();
  if (!raw || raw === "transparent") return "";
  if (/rgba\([^)]*,\s*0(\.0+)?\s*\)$/.test(raw)) return "";
  return nearestOption(raw, branding) ?? toHex(raw);
}

/**
 * Is this band dark enough to need the light-on-dark theme?
 *
 * Only where there is a band at all — `rgba(0, 0, 0, 0)` is how a computed
 * style spells *transparent*, and reading its channels as a colour makes every
 * unpainted section look like the darkest one there is.
 */
const isDark = (value) => {
  if (!value) return false;
  const m = String(value).match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  if (!m) return false;
  const [r, g, b] = m.slice(1).map(Number);
  return 0.299 * r + 0.587 * g + 0.114 * b < 140;
};

/**
 * The accordion's design, as the custom properties the target's accordion
 * reads.
 *
 * Every colour goes through `nearestOption`, so the brand blue these title bars
 * are painted with emits `var(--color-brand)` and follows a later rebrand
 * instead of freezing as `#3db5fb`. Font *family* is deliberately absent: the
 * measured `Lato` is already the target's body font, so inheriting is both
 * correct and rebrand-safe. Size and weight are kept because they genuinely
 * differ from the target's own defaults (18px/400 against xl/bold).
 */
export function accordionTheme(measured, branding = {}) {
  if (!measured) return null;
  const theme = {
    titleBackground: colorValue(measured.titleBackground, branding),
    titleColor: colorValue(measured.titleColor, branding),
    titleBackgroundOpen: colorValue(measured.titleBackgroundOpen, branding),
    titleColorOpen: colorValue(measured.titleColorOpen, branding),
    titleFontSize: measured.titleFontSize || "",
    titleFontWeight: measured.titleFontWeight || "",
    titlePadding: measured.titlePadding || "",
    titleGap: measured.titleGap || "",
    itemGap: /^0(px)?$/.test(measured.itemGap || "") ? "" : measured.itemGap || "",
    itemBorder: hexifyCss(measured.itemBorder || ""),
    detailPadding: measured.detailPadding || "",
    detailBorderTop: hexifyCss(measured.detailBorderTop || ""),
    detailBorderRight: hexifyCss(measured.detailBorderRight || ""),
    detailBorderBottom: hexifyCss(measured.detailBorderBottom || ""),
    detailBorderLeft: hexifyCss(measured.detailBorderLeft || ""),
  };
  // An accordion whose open and closed bars are both unpainted was never
  // designed — emitting a theme for it would only pin the target's own
  // defaults in place and defeat a later change to them.
  const painted =
    theme.titleBackground ||
    theme.titleBackgroundOpen ||
    theme.itemGap ||
    [theme.detailBorderTop, theme.detailBorderRight, theme.detailBorderBottom, theme.detailBorderLeft]
      .some((v) => v && v !== "0");
  return painted ? theme : null;
}

/** The page block for one captured accordion. */
export function accordionBlock(
  accordion,
  { ref, heading = "", id = "", label = "", bandColor = "", hasLeadRun = false, branding = {}, rewriteHtml } = {}
) {
  const band = colorValue(bandColor, branding);
  return {
    _component: ref,
    id,
    heading,
    headingLevel: "h2",
    headingSize: "lg",
    label,
    // The source's own settings: one panel at a time, first one open.
    singleOpen: true,
    openFirst: accordion.openFirst !== false,
    // No chevron where the source had none — the colour change between the
    // closed bar and the open one IS the affordance there, and adding an icon
    // the design never had is the same class of error as dropping one it did.
    iconName: accordion.theme?.hasIcon === false ? "" : "chevron-down",
    items: (accordion.items || []).map((item) => ({
      _component: ACCORDION_ITEM,
      title: item.title || "",
      contentSections: segmentsToSections(item.segments, { rewriteHtml }),
    })),
    maxContentWidth: "xl",
    paddingHorizontal: "lg",
    // A lead run and its accordion are one band in the source; giving the
    // accordion its own section padding would open a gap the source never had.
    paddingVertical: hasLeadRun ? "none" : "4xl",
    // Derived from the band this section actually paints, not from the raw
    // measurement: an unpainted section inherits whatever the page around it is.
    colorScheme: band && isDark(bandColor) ? "contrast" : "inherit",
    backgroundColor: "none",
    backgroundColorHex: band,
    backgroundGradient: "",
    accordionTheme: accordionTheme(accordion.theme, branding),
  };
}

/** Deep copy minus the dropped nodes, and minus containers they leave empty. */
export function pruneNodes(tree, keep, isRoot = true) {
  const children = (tree.children || [])
    .map((child) => pruneNodes(child, keep, false))
    .filter(Boolean);
  if (!isRoot && !keep(tree) && children.length === 0) return null;
  return { ...tree, children };
}

/** Does a pruned tree still carry anything worth emitting? */
export function hasContent(tree) {
  let found = false;
  (function walk(node) {
    if (found) return;
    if (!["container", "spacer", "decor"].includes(node.kind)) found = true;
    for (const child of node.children || []) walk(child);
  })(tree);
  return found;
}

/**
 * Split a section into the runs of ordinary content around its accordions.
 *
 * Node numbers are assigned depth-first in document order by `BUILD_TREE`, so
 * an accordion's `[minN, maxN]` is a contiguous slice of the section and the
 * parts fall out of that ordering. A section is rarely *only* an accordion —
 * this site's video widget shares its section with the Patient Forms block
 * above it, and routing the whole section to the accordion would have thrown
 * that away.
 */
export function splitByAccordions(tree, accordions = []) {
  const list = [...accordions].filter((a) => a?.items?.length).sort((a, b) => a.minN - b.minN);
  if (!list.length) return [{ kind: "run", tree }];

  const parts = [];
  const dropped = new Set(list.flatMap((a) => a.nodes));
  const addRun = (lo, hi) => {
    const pruned = pruneNodes(tree, (node) => !dropped.has(node.n) && node.n > lo && node.n < hi);
    if (hasContent(pruned)) parts.push({ kind: "run", tree: pruned });
  };

  let cursor = -1;
  for (const accordion of list) {
    addRun(cursor, accordion.minN);
    parts.push({ kind: "accordion", accordion });
    cursor = accordion.maxN;
  }
  addRun(cursor, Infinity);
  return parts;
}

/**
 * Split a section at the source's own in-page anchor targets.
 *
 * A page builder can nest what the author treats as two sections inside one
 * container: the nav links to `#patient-forms` and `#dental-videos`, but the
 * second lives *inside* the first's box, so rendered geometry reads the two as
 * one section and everything below "Patient Forms" is swept into it. The anchor
 * the author wired to their own navigation is the boundary they intended, and
 * segmentation has no other signal for it — a divider between two widgets is
 * decoration, an id a menu jumps to is structure.
 *
 * `boundaryNs` are the node numbers those targets begin at. Node numbers are
 * assigned depth-first in document order (`BUILD_TREE`), so each boundary is a
 * clean slice and the boundary node opens its own part. A section with no
 * interior anchor comes back whole, so the common case is untouched.
 */
export function splitByAnchors(tree, boundaryNs = []) {
  const bounds = [...new Set(boundaryNs)].filter((n) => n > tree.n).sort((a, b) => a - b);
  if (!bounds.length) return [tree];

  const edges = [tree.n, ...bounds, Infinity];
  const parts = [];
  for (let i = 0; i < edges.length - 1; i++) {
    // The boundary node starts its own part; everything before the first
    // boundary is the section's own lead content.
    const lo = i === 0 ? -Infinity : edges[i];
    const hi = edges[i + 1];
    const pruned = pruneNodes(tree, (node) => node.n >= lo && node.n < hi);
    if (hasContent(pruned)) parts.push(pruned);
  }
  return parts.length ? parts : [tree];
}

/**
 * Move a heading into the accordion when — and only when — it sits directly
 * against it.
 *
 * `FaqSection` renders its own heading above the panels, so a section whose
 * last words before the accordion are its title reads better with the two
 * joined. But hoisting a heading past the intro paragraph that followed it
 * would reorder the page, so anything short of adjacency is left where the
 * source put it and the accordion goes out headless (an empty `heading`
 * renders nothing — `Heading.astro` returns early on it).
 */
export function pullUpHeading(runTree) {
  const nodes = [];
  (function walk(node) {
    if (node.kind !== "container") nodes.push(node);
    for (const child of node.children || []) walk(child);
  })(runTree);
  const last = nodes[nodes.length - 1];
  if (!last || last.kind !== "heading") return { heading: "", tree: runTree };
  const text = (last.html || last.text || "").trim();
  if (!text) return { heading: "", tree: runTree };
  const pruned = pruneNodes(runTree, (node) => node.n !== last.n);
  return { heading: text, tree: hasContent(pruned) ? pruned : null };
}
