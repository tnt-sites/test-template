import valueParser from "postcss-value-parser";

/**
 * Root font-size detection and `rem` normalisation.
 *
 * Many hand-written sites set `html { font-size: 10px }` (or `62.5%`) so authors
 * can write `1.6rem` and mean 16px. Porting such a stylesheet into a template
 * that uses a normal 16px root silently scales every ported length by 1.6x —
 * fonts, spacing, widths, the lot. So `rem` lengths are converted to absolute
 * px at emit time, and the source's own root rule is never carried over.
 */

const DEFAULT_ROOT_PX = 16;

/** Properties whose values are lengths we should normalise. */
const SKIP_PROPS = new Set(["content", "counter-reset", "counter-increment", "quotes"]);

/**
 * Find the effective root font-size across the source stylesheets.
 *
 * Sheets are given in cascade order, so a later `html { font-size }` wins — a
 * reset that sets `100%` followed by a theme that sets `10px` resolves to 10px,
 * which is exactly the case that makes this worth doing properly.
 */
export function detectRootFontSize(sheets) {
  let resolved = null;

  for (const sheet of sheets) {
    const css = typeof sheet === "string" ? sheet : sheet.css;
    // `html` or `:root`, with or without whitespace, minified or not.
    for (const m of css.matchAll(
      /(?:^|[},;])\s*(?:html|:root)\s*\{[^}]*?font-size\s*:\s*([^;}]+)[;}]/gi
    )) {
      const px = lengthToPx(m[1].trim(), DEFAULT_ROOT_PX);
      if (px && px > 0) resolved = px;
    }
  }

  return resolved;
}

/** Convert a single CSS length token to px, or null if it isn't convertible. */
export function lengthToPx(value, rootPx = DEFAULT_ROOT_PX) {
  const v = String(value).trim();

  const pct = v.match(/^([\d.]+)%$/);
  if (pct) return (Number(pct[1]) / 100) * DEFAULT_ROOT_PX;

  const num = v.match(/^([\d.]+)(px|rem|em|pt)$/i);
  if (!num) return null;

  const n = Number(num[1]);
  switch (num[2].toLowerCase()) {
    case "px":
      return n;
    case "pt":
      return (n * 96) / 72;
    case "rem":
      return n * rootPx;
    case "em":
      return n * rootPx; // only valid at the root; callers handle nested em
    default:
      return null;
  }
}

/**
 * Rewrite every `rem` length in a declaration value to absolute px.
 *
 * Only runs when the source root differs from the target's 16px — a site that
 * already uses a 16px root is ported verbatim, which keeps diffs readable.
 */
export function normalizeRemInValue(value, rootPx) {
  if (!rootPx || rootPx === DEFAULT_ROOT_PX) return value;
  if (!/\drem\b/i.test(value)) return value;

  const parsed = valueParser(value);
  parsed.walk((node) => {
    if (node.type !== "word") return;
    const m = node.value.match(/^(-?[\d.]+)rem$/i);
    if (!m) return;
    const px = Number(m[1]) * rootPx;
    node.value = `${round(px)}px`;
  });
  return parsed.toString();
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}

/**
 * True if a rule is the source's own root font-size declaration. Those must be
 * dropped: re-declaring a 10px root inside the target would rescale the entire
 * template, not just the ported CSS.
 */
export function isRootFontSizeRule(selector, prop) {
  return /^\s*(html|:root)\s*$/i.test(selector) && prop.toLowerCase() === "font-size";
}

/** Apply rem normalisation across a parsed PostCSS root, in place. */
export function normalizeRoot(root, rootPx) {
  if (!rootPx || rootPx === DEFAULT_ROOT_PX) return { converted: 0, dropped: 0 };

  let converted = 0;
  let dropped = 0;

  root.walkRules((rule) => {
    rule.walkDecls((decl) => {
      if (isRootFontSizeRule(rule.selector, decl.prop)) {
        decl.remove();
        dropped++;
        return;
      }
      if (SKIP_PROPS.has(decl.prop.toLowerCase())) return;

      const next = normalizeRemInValue(decl.value, rootPx);
      if (next !== decl.value) {
        decl.value = next;
        converted++;
      }
    });
    if (rule.nodes.length === 0) rule.remove();
  });

  return { converted, dropped };
}

/**
 * Guard rail. Emitting a root font-size into the target rescales every token in
 * the template, so this is checked before anything is written.
 */
export function assertNoRootFontSize(css, context = "emitted CSS") {
  const m = css.match(/(?:^|[},;])\s*(?:html|:root)[^{}]*\{[^}]*font-size\s*:/i);
  if (m) {
    throw new Error(
      `${context} sets a root font-size. That rescales the whole target template — ` +
        `it must be stripped and its rem values converted to px instead.`
    );
  }
}

export { DEFAULT_ROOT_PX };
