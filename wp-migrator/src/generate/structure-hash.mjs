/**
 * Structural identity for a generated component.
 *
 * The migrator names components from their content (`nameFromContent`), so the
 * same widget is called `aetna-dental` on one page and `delta-dental` on the
 * next. Identity has to come from *shape* instead, or the registry can never
 * tell that two pages captured the same section.
 *
 * Everything here operates on the emitted `.astro` text, which is the one
 * artifact both the generator and the one-time consolidation pass hold.
 */

import crypto from "node:crypto";

/**
 * Property values that are measurement noise rather than design intent.
 *
 * These are read off one rendered page, so the same design measured on two
 * pages differs by whatever that page's content pushed around: a banner
 * captured at 426px on one page and 470px on another is one design at two
 * content lengths, and `top` follows `min-height` because the emitter positions
 * absolute overlays relative to the box it just measured.
 */
const QUANTIZED =
  /\b(min-height|min-width|max-height|max-width|height|width|top|bottom|left|right)\s*:\s*(-?\d+(?:\.\d+)?)px/g;

/**
 * Round to a 64px step.
 *
 * The toothbar banners forked at 426px vs 470px — a 44px spread that a 4px
 * quantum could never close, because the difference is real measurement, not
 * rounding. The step has to be coarser than the spread one design shows across
 * pages while staying finer than the gap between two designs; 64px keeps a
 * 426/470 banner together and still separates it from a 900px hero.
 */
const QUANTUM = 64;

/**
 * Transform matrices carry six floats of hover-scale precision that differ
 * between captures of the same effect — the toothbar banners read the one
 * hover-grow as 1.06664, 1.06667, 1.05758 and 1.05761. Round each component to
 * 1dp: a hover scale is a design decision at "about 1.1x", and a sub-1%
 * spread across four captures is the measurement, not the intent. Translate
 * offsets in matrix3d ride along, which is what we want — they track the same
 * measured box the position values above do.
 */
const MATRIX = /\bmatrix(3d)?\(([^)]*)\)/g;

function quantizeMatrices(src) {
  return src.replace(MATRIX, (_, d3, args) => {
    const rounded = args
      .split(",")
      .map((n) => {
        const v = Number(n.trim());
        return Number.isFinite(v) ? String(Math.round(v * 10) / 10) : n.trim();
      })
      .join(", ");
    return `matrix${d3 || ""}(${rounded})`;
  });
}

/**
 * Collapse every class name to a single token.
 *
 * Generated class names are derived from the component name (`.aetna-dental`,
 * `.ad-box`), so they encode exactly the content-derived identity we are trying
 * to look past. Longest-first substitution keeps `.ad-box` from being eaten by
 * a partial match on `.ad`.
 */
function canonicalizeClasses(src) {
  const names = new Set();

  for (const attr of src.matchAll(/class="([^"]*)"/g)) {
    for (const n of attr[1].matchAll(/[a-zA-Z][\w-]*/g)) names.add(n[0]);
  }
  for (const sel of src.matchAll(/\.([a-zA-Z][\w-]*)/g)) names.add(sel[1]);

  let out = src;

  for (const n of [...names].sort((a, b) => b.length - a.length)) {
    out = out.replace(
      new RegExp(`(?<![\\w-])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, "g"),
      "C"
    );
  }
  return out;
}

/** Strip the provenance doc comment — it names the source page by definition. */
const stripDoc = (src) => src.replace(/\/\*\*[\s\S]*?\*\//, "");

/**
 * Blank out prop *default values* in the destructuring block.
 *
 * A default is content, not structure: two banners that differ only in
 * `headingColor = "#1b2e38"` vs `"#ffffff"`, or in which stock background image
 * the capturing page happened to use, are the same component. The site also
 * carries whole families whose only difference is a hover colour measured at
 * four opacities of the same fade (`rgba(241,241,241, .58/.68/.77/.84)`) —
 * genuinely one design, four readings of it. Prop *names* still count, so a
 * component that gains a real slot stays distinct.
 *
 * Must run BEFORE `canonicalizeClasses`: that pass rewrites every
 * `[a-zA-Z][\w-]*` following a dot, which turns `"/hero.jpg"` into `"/hero.C"`
 * and `"/hero.webp"` into `"/hero.C"` — different strings either way, but no
 * longer matching the quoted-literal pattern here. Running it second is what
 * let two banners fork on nothing but which stock image their page used.
 */
function blankDefaults(src) {
  const open = src.indexOf("const {");
  const close = src.indexOf("} = Astro.props;");

  if (open === -1 || close === -1 || close < open) return src;

  const head = src.slice(0, open);
  const block = src.slice(open, close);
  const tail = src.slice(close);

  return head + block.replace(/=\s*(?:"(?:[^"\\]|\\.)*"|\[\]|'[^']*')/g, "= D") + tail;
}

function quantize(src) {
  return quantizeMatrices(
    src.replace(
      QUANTIZED,
      (_, prop, px) => `${prop}:${Math.round(Number(px) / QUANTUM) * QUANTUM}px`
    )
  );
}

/**
 * Normalized line tokens for a component, for both hashing and similarity.
 * Blank lines and indentation are dropped: the emitter's indentation tracks
 * nesting depth, which the tag sequence already carries.
 */
export function structureTokens(astroSource) {
  const normalized = quantize(canonicalizeClasses(blankDefaults(stripDoc(astroSource))));

  return normalized
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Like `structureTokens`, but over the markup body only — the frontmatter and
 * the `<style>` block are dropped.
 *
 * Clustering asks a different question than exact-reuse hashing does. Two
 * sections built from the same page template carry the *same markup shape* but
 * a per-instance wall of measured CSS: an Elementor content block is ~30 lines
 * of markup under ~280 lines of scoped rules, each rule a pixel value read off
 * one capture. Hashing the whole file lets that CSS — four breakpoints of it —
 * dominate the token stream, so two components that a human would call the same
 * widget score far below threshold and never reach the merge planner, which is
 * itself the thing that decides (by slot contract, content-preservingly)
 * whether they may actually collapse. Measuring similarity on the markup alone
 * puts that decision back where the safety checks live. Prop defaults and class
 * names are still canonicalized, so only the element/slot shape remains.
 */
export function markupTokens(astroSource) {
  const stripped = canonicalizeClasses(blankDefaults(stripDoc(astroSource)));
  const parts = stripped.split(/^---$/m);
  const body = parts.length > 2 ? parts.slice(2).join("---") : stripped;
  const markup = body.split("<style")[0];

  return markup
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Stable short hash of a component's structure. Equal hash -> safe to share. */
export function structureHash(astroSource) {
  return crypto
    .createHash("sha1")
    .update(structureTokens(astroSource).join("\n"))
    .digest("hex")
    .slice(0, 12);
}

/**
 * Similarity of two token streams in [0,1], by longest-common-subsequence over
 * whole lines — the same measure `difflib.SequenceMatcher` reports, so the
 * thresholds quoted in the migration notes carry over.
 *
 * O(n*m) on line counts; the largest generated component is ~1,200 lines, so
 * the worst pair is ~1.4M cells. Callers cap how many candidates they compare.
 */
export function similarity(a, b) {
  if (!a.length && !b.length) return 1;
  if (!a.length || !b.length) return 0;

  // Row-at-a-time LCS: only the previous row is ever needed.
  let prev = new Uint32Array(b.length + 1);
  let cur = new Uint32Array(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    [prev, cur] = [cur, prev];
    cur.fill(0);
  }
  return (2 * prev[b.length]) / (a.length + b.length);
}
