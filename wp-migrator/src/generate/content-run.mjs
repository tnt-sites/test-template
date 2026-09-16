/**
 * Recognise a section that is a *run of content* rather than a design, and
 * express it as data instead of as a new component.
 *
 * This is the single biggest source of duplicate components the migrator
 * produces, and it is not the one it looks like from the outside. The obvious
 * theory is that near-identical sections fork on paint or measurement — the
 * same band at two background colours, one banner measured 44px taller than
 * another. `structure-hash.mjs` already absorbs both, and on the Taylor Dental
 * Care site neither was ever the cause: blanking every content-sized box metric
 * in the identity merged *zero* of its fifty-four components.
 *
 * What actually forks them is **length**. A WordPress interior page is a linear
 * run of headings, paragraphs, photos and buttons, and the emitter turns each
 * captured run into a component whose props are that run's slots — `heading`,
 * `text`, `heading2`, `text2`, ... So a run of three headings and a run of ten
 * are different components with different prop lists, and no reuse rule
 * operating on a fixed prop list can ever unify them. That site ended with
 * `media-prose-b` through `-i`, `card-grid-home-botox` through `-teeth`, and
 * `prose-block-home-cerec` through `-success`: forty files for one design at
 * forty lengths.
 *
 * The fix is to stop treating length as structure. A section that is only a run
 * of content carries no design of its own worth a component, so it is emitted
 * as an ordered `blocks` array on one shared parametric component, and the
 * things that genuinely vary between instances — where the photo floats, how
 * the copy aligns — are inputs on it.
 *
 * `bin/collapse-families.mjs` does the same conversion for output that already
 * exists. This is the same rule applied before the fork happens.
 */

/**
 * Node kinds a content run may contain.
 *
 * Anything else is a widget: an `embed` is a form or a map, `raw` is a table or
 * an SVG, `list` survives as rich text but a repeat does not. A section holding
 * one of those is a design, and forking a component for it is correct.
 */
const RUN_KINDS = new Set([
  "container",
  "heading",
  "text",
  "richtext",
  "list",
  "img",
  "button",
  "textlink",
  "spacer",
  "divider",
]);

/** Kinds that carry no content but are harmless inside a run. */
const IGNORED_KINDS = new Set(["spacer"]);

const walk = (node, fn) => {
  fn(node);
  for (const child of node.children || []) walk(child, fn);
};

const paints = (styles) => {
  if (!styles) return false;
  const bg = styles.backgroundColor;
  const img = styles.backgroundImage;
  const opaque = bg && bg !== "transparent" && !/rgba\([^)]*,\s*0(\.0+)?\)\s*$/.test(bg);

  return Boolean(opaque || (img && img !== "none"));
};

/**
 * Does this section paint a design of its own?
 *
 * The root's own background is only half of it. The interior page banner on
 * this site paints nothing on its root and lays a 50%-opacity lime wash over
 * its photo with a `::before` — so checking the root alone classified the
 * banner as a plain run of content and would have flattened it.
 *
 * `rec` is the whole captured record, which carries the pseudo-elements
 * alongside the element's own styles.
 */
function paintsBand(rec) {
  if (!rec) return false;
  return paints(rec.styles) || paints(rec.before) || paints(rec.after);
}

/**
 * Classify a captured section.
 *
 * Returns `{ blocks, align, hasMedia }` when the section is a content run, or
 * `null` when it is a design that deserves its own component. The caller owns
 * the decision of what to do with it — this module only answers the question.
 */
export function asContentRun(tree, { record = null, hasRepeats = false, styles = null } = {}) {
  if (!tree || hasRepeats) return null;
  if (paintsBand(record)) return null;

  // A painted CHILD — a coloured card in a flex row, or an image column with its
  // slant overlay — is a design, not a plain run. The section root is often
  // transparent while its children carry the colour/photo, so extend the paint
  // test past the root. `styles` is the per-node style-record map for the
  // widest breakpoint (node number -> { styles, before, after }).
  if (styles) {
    let designed = false;
    walk(tree, (node) => {
      if (designed || node.kind !== "container" || node.n === tree.n) return;
      if (paintsBand(styles[node.n])) designed = true;
    });
    if (designed) return null;
  }

  let ok = true;
  const nodes = [];
  // A column/container can carry a photo as a CSS `background-image` rather than
  // an <img> (Elementor's image columns do this). Those are invisible to the
  // <img> sweep below, so a section built entirely that way loses its photo.
  // Capture the first real background-image url we see (skip gradients + logos).
  let bgImageUrl = "";

  walk(tree, (node) => {
    if (!RUN_KINDS.has(node.kind)) ok = false;
    if (node.kind !== "container" && !IGNORED_KINDS.has(node.kind)) nodes.push(node);
    if (!bgImageUrl) {
      const bi = styles?.[node.n]?.styles?.backgroundImage || node.styles?.backgroundImage || "";
      const m = /url\(\s*["']?([^"')]+\.(?:jpg|jpeg|png|webp|avif))["']?\s*\)/i.exec(bi);
      if (m && !/logo/i.test(m[1])) bgImageUrl = m[1];
    }
  });
  if (!ok) return null;

  const blocks = [];
  let pendingButtons = null;
  let imageIndex = -1;
  let proseIndex = -1;
  // The section's own measured design, read off the first heading / button /
  // divider it contains. The shared content-section bakes one *other* site's
  // design; passing these lets it render *this* section's — see `measureDesign`.
  let headingNode = null;
  let buttonNode = null;
  let dividerNode = null;

  const flushButtons = () => {
    if (pendingButtons?.buttons.length) blocks.push(pendingButtons);
    pendingButtons = null;
  };

  for (const node of nodes) {
    if (node.kind === "button" || node.kind === "textlink") {
      const text = (node.text || "").trim();

      if (!text) continue;
      if (!buttonNode && node.kind === "button") buttonNode = node;
      pendingButtons ??= { type: "buttons", buttons: [] };
      pendingButtons.buttons.push({ text, link: node.attrs?.href || "#" });
      continue;
    }

    flushButtons();

    if (node.kind === "divider") {
      if (!dividerNode) dividerNode = node;
      blocks.push({ type: "divider" });
      continue;
    }

    if (node.kind === "img") {
      const source = node.attrs?.src || "";

      if (!source || /logo/i.test(source)) continue;
      if (imageIndex === -1) imageIndex = blocks.length;
      blocks.push({ type: "image", source, alt: node.attrs?.alt || "" });
      continue;
    }

    const html = (node.html || node.text || "").trim();

    if (!html) continue;

    if (node.kind === "heading") {
      const level = Number(String(node.tag || "h2")[1]) || 2;
      const block = level >= 3 ? { type: "subheading", html } : { type: "heading", html };

      if (level === 1) block.level = 1;
      if (!headingNode && level < 3) headingNode = node;
      blocks.push(block);
      continue;
    }
    if (proseIndex === -1) proseIndex = blocks.length;
    blocks.push({ type: "prose", html });
  }
  flushButtons();

  // No inline <img>, but the section carried a photo as a background — surface
  // it as the section's media so the run keeps its image.
  if (imageIndex === -1 && bgImageUrl) {
    imageIndex = blocks.length;
    blocks.push({ type: "image", source: bgImageUrl, alt: "" });
  }

  if (blocks.length === 0) return null;
  // A run of nothing but a button or a photo is a widget, not a content band.
  if (!blocks.some((b) => b.type === "heading" || b.type === "prose" || b.type === "subheading")) {
    return null;
  }

  // Where the photo floats: the source's `.elem-left` puts the figure before
  // the copy it wraps, `.elem-right` after it.
  const side =
    imageIndex === -1 || (proseIndex !== -1 && imageIndex > proseIndex) ? "right" : "left";

  for (const block of blocks) {
    if (block.type === "image") block.side = side;
  }

  const result = {
    blocks,
    // Read off the content, not just the section root. A builder centres the
    // heading and the paragraph and leaves the container it put them in at its
    // `start` default, so consulting the root alone reported this page's
    // centred "Educational Dental Videos" band as left-aligned — the same
    // "only the root was measured" failure as the paint test above. The root
    // still breaks a tie, since it is what an unstyled run inherits.
    align:
      centredRun(nodes, styles) ?? (record?.styles?.textAlign === "center" ? "center" : "left"),
    hasMedia: imageIndex !== -1,
  };

  const design = measureDesign(styles, {
    headingNode,
    buttonNode,
    dividerNode,
    rootWidth: styles?.[tree.n]?.box?.w || 0,
  });
  if (design) result.design = design;

  return result;
}

/**
 * Is this run centred, going by the text it actually contains?
 *
 * Returns null when the nodes do not agree, leaving the decision to the root.
 */
function centredRun(nodes, styles) {
  if (!styles) return null;
  let centred = 0;
  let other = 0;
  for (const node of nodes) {
    if (node.kind !== "heading" && node.kind !== "text" && node.kind !== "richtext") continue;
    const align = styles[node.n]?.styles?.textAlign;
    if (!align) continue;
    if (align === "center") centred += 1;
    else other += 1;
  }
  if (!centred && !other) return null;
  return centred > other ? "center" : null;
}

/** A colour that actually paints — not `transparent` or a fully-clear rgba. */
const opaqueColor = (c) =>
  Boolean(c) && c !== "transparent" && !/rgba\([^)]*,\s*0(\.0+)?\)\s*$/.test(c);

/**
 * Read the section's own design off the nodes it flattened.
 *
 * The shared content-section is a parametric band, and its baked typography,
 * button and divider are one migration's — the first the component was cut for.
 * A run on a *different* site is the same shape but not the same design, and no
 * component with hardcoded numbers can be both. So the run carries its measured
 * design (heading font/size/weight/colour/alignment, the button's fill and
 * shape, the divider's colour and weight) as data, and the component paints
 * with it — falling back to its baked values only for whatever wasn't measured,
 * so a section that supplies nothing renders exactly as before.
 */
function measureDesign(styles, { headingNode, buttonNode, dividerNode, rootWidth = 0 }) {
  if (!styles) return null;
  const rec = (node) => (node ? styles[node.n]?.styles || null : null);
  const box = (node) => (node ? styles[node.n]?.box || null : null);
  const px = (v) => {
    const m = /(-?[\d.]+)px/.exec(v || "");
    return m ? Math.round(parseFloat(m[1])) : null;
  };
  const prune = (obj) => {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || v === undefined || v === "" || v === "normal") continue;
      out[k] = v;
    }
    return Object.keys(out).length ? out : null;
  };

  const design = {};

  const h = rec(headingNode);
  if (h) {
    const heading = prune({
      fontFamily: h.fontFamily,
      fontSize: px(h.fontSize),
      fontWeight: h.fontWeight,
      lineHeight: px(h.lineHeight),
      color: opaqueColor(h.color) ? h.color : null,
      align: h.textAlign === "center" || h.textAlign === "right" ? h.textAlign : null,
      // Pass "none" through: a measured heading opts out of the component's
      // baked `capitalize`, so it must say so explicitly, not fall back to it.
      textTransform: h.textTransform,
    });
    if (heading) design.heading = heading;
  }

  const b = rec(buttonNode);
  if (b) {
    const button = prune({
      background: opaqueColor(b.backgroundColor) ? b.backgroundColor : null,
      color: opaqueColor(b.color) ? b.color : null,
      radius: b.borderTopLeftRadius,
      uppercase: /upper/i.test(b.textTransform || "") || null,
      paddingBlock: b.paddingTop,
      paddingInline: b.paddingLeft,
    });
    if (button) design.button = button;
  }

  const d = rec(dividerNode);
  if (d && d.borderTopStyle && d.borderTopStyle !== "none") {
    // A rule's rendered width IS its design (a used width is normally noise, but
    // an empty bordered bar has no content to be sized by — it is the authored
    // cap). Prefer an explicit `max-width`; else read the box, and record it
    // only where the bar is clearly held in from the band it sits across.
    const dBox = box(dividerNode);
    let maxWidth = d.maxWidth && d.maxWidth !== "none" ? d.maxWidth : null;
    if (!maxWidth && dBox?.w > 0 && rootWidth > 0 && dBox.w < rootWidth * 0.9) {
      maxWidth = `${dBox.w}px`;
    }
    const divider = prune({
      color: opaqueColor(d.borderTopColor) ? d.borderTopColor : null,
      weight: d.borderTopWidth,
      style: d.borderTopStyle,
      maxWidth,
    });
    if (divider) design.divider = divider;
  }

  return Object.keys(design).length ? design : null;
}
