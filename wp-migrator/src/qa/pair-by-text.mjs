/**
 * Pair source and built elements by their text, and report style mismatches.
 *
 * `bin/compare.mjs` pairs a built element with its source counterpart through
 * `data-wpmig-n` — the index `BUILD_TREE` stamps while walking the DOM. That
 * index is *positional*, and the two DOMs it has to bridge are not the same
 * shape: `BUILD_TREE` collapses pass-through wrappers by geometry, and the
 * Astro rebuild has a different set of wrappers than WordPress emitted. When
 * the two sides collapse differently every index past that point shifts, and
 * the comparison silently pairs each built node with its *neighbour's* source.
 *
 * `refine/index.mjs` then copies the wrong node's typography in good faith.
 * That is how the restorative dentistry page ended up with `<h2>Schedule an
 * Appointment</h2>` at body size and the paragraph under it at 32px: the
 * heading was compared against the paragraph and "corrected" to match.
 *
 * Text is the stable key. A heading says the same words in both DOMs no matter
 * how its wrappers collapsed, so pairing on normalized text finds the true
 * counterpart or honestly finds nothing. It cannot pair the wrapper elements
 * that carry no text of their own — those keep needing the positional path —
 * but typography corrections only ever apply to elements that *do* have text,
 * which is exactly the set this covers.
 */

/** Text as an identity: whitespace collapsed, nbsp folded, case-insensitive. */
export const textKey = (s) =>
  (s || "")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** The properties a mismatch is worth reporting on. */
export const COMPARED = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "textAlign",
  "color",
  "backgroundColor",
];

/**
 * Read every text-bearing element on the page, keyed by its text.
 *
 * Runs inside the browser. Only elements whose text is their *own* — no child
 * element contributes a different string — are collected, so an outer wrapper
 * does not shadow the heading it contains. Keys occurring more than once are
 * dropped rather than guessed at: an ambiguous pair is worse than no pair.
 */
export const READ_TEXT_NODES = () => {
  const norm = (s) =>
    (s || "").replace(/ /g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  const props = [
    "fontFamily",
    "fontSize",
    "fontWeight",
    "lineHeight",
    "textAlign",
    "color",
    "backgroundColor",
  ];
  const seen = new Map();

  for (const el of document.querySelectorAll("h1,h2,h3,h4,h5,h6,p,a,li,span,div,td,th,figcaption,button")) {
    const key = norm(el.textContent);

    if (!key || key.length < 4 || key.length > 300) continue;
    // Only the innermost element that owns this exact text.
    if ([...el.children].some((c) => norm(c.textContent) === key)) continue;
    const cs = getComputedStyle(el);

    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const rect = el.getBoundingClientRect();

    if (rect.width === 0 || rect.height === 0) continue;

    const style = {};

    for (const p of props) style[p] = cs[p];
    // Report the family the browser actually resolved, not the whole stack.
    style.fontFamily = style.fontFamily.split(",")[0].replace(/["']/g, "").trim();
    // `start` and `left` are the same thing in an LTR document; the two sides
    // report them differently and every element would show as a mismatch.
    if (style.textAlign === "start") style.textAlign = "left";
    if (style.textAlign === "end") style.textAlign = "right";

    const classes = [...el.classList];

    if (seen.has(key)) seen.get(key).count += 1;
    else seen.set(key, { tag: el.tagName, style, classes, count: 1 });
  }
  return [...seen.entries()]
    .filter(([, v]) => v.count === 1)
    .map(([key, v]) => [key, { tag: v.tag, style: v.style, classes: v.classes }]);
};

/**
 * Compare two `READ_TEXT_NODES` results.
 *
 * `ignore` skips properties a page legitimately restyles — the built site uses
 * its own token palette for links, and flagging every anchor colour would bury
 * the real findings.
 */
export function diffTextNodes(sourceEntries, builtEntries, { ignore = [] } = {}) {
  const source = new Map(sourceEntries);
  const built = new Map(builtEntries);
  const skip = new Set(ignore);
  const findings = [];

  for (const [key, b] of built) {
    const s = source.get(key);

    if (!s) continue;

    const diffs = [];

    for (const prop of COMPARED) {
      if (skip.has(prop)) continue;
      if (s.style[prop] !== b.style[prop]) diffs.push({ prop, source: s.style[prop], built: b.style[prop] });
    }
    if (diffs.length) findings.push({ key, sourceTag: s.tag, builtTag: b.tag, diffs });
  }
  return findings;
}

/**
 * Findings where the built element's type differs from the source's by enough
 * to change the page's reading order — a heading rendered at body size, or
 * body copy rendered at heading size. These are the ones worth fixing first.
 */
export function severeFindings(findings) {
  return findings.filter(({ diffs }) => {
    const size = diffs.find((d) => d.prop === "fontSize");
    const family = diffs.find((d) => d.prop === "fontFamily");

    if (!size && !family) return false;
    if (!size) return true;
    const from = parseFloat(size.source);
    const to = parseFloat(size.built);

    return Math.abs(from - to) >= 6;
  });
}
