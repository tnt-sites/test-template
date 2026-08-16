import postcssSelectorParser from "postcss-selector-parser";
import { isResetRule, isLegacyVendorDecl } from "./parse.mjs";
import { urlsInValue, rewriteUrls } from "./assets.mjs";

/**
 * Port the source's global element styling.
 *
 * Tokens carry colour and font family, but a site's character also lives in the
 * rules it writes against bare elements — paragraph rhythm, link decoration,
 * heading sizes and weights, list markers. Those never reach a token, so
 * without this the migrated pages use the template's typography wearing the
 * source's palette.
 *
 * Only element-level rules cross over. Anything scoped to a class or id belongs
 * to a specific component and would leak unpredictably into the target's own
 * markup, which happens to reuse many of the same generic class names.
 */

/** Elements whose styling defines a site's base typography and rhythm. */
const BASE_ELEMENTS = new Set([
  "body",
  "p",
  "a",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "strong",
  "em",
  "small",
  "hr",
  "figure",
  "figcaption",
  "table",
  "th",
  "td",
]);

/** Properties worth carrying. Layout and positioning belong to the template. */
const BASE_PROPERTIES = new Set([
  "color",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "line-height",
  "letter-spacing",
  "text-transform",
  "text-decoration",
  "text-decoration-line",
  "text-decoration-color",
  "text-align",
  "margin",
  "margin-top",
  "margin-bottom",
  "margin-block",
  "margin-block-start",
  "margin-block-end",
  "list-style",
  "list-style-type",
  "list-style-position",
  "font",
]);

/**
 * True when every compound in the selector is a bare element.
 *
 * `p`, `main ul li`, `a:hover` qualify. `.card p` and `#hero a` do not: those
 * describe one component's internals, and the target's markup reuses enough
 * generic class names that porting them lands styling on unrelated elements.
 */
export function isElementSelector(selector) {
  let bare = true;
  let touchesBaseElement = false;

  try {
    postcssSelectorParser((root) => {
      root.walk((node) => {
        if (node.type === "class" || node.type === "id" || node.type === "universal") {
          bare = false;
        }
        if (node.type === "attribute") bare = false;
        if (node.type === "tag" && BASE_ELEMENTS.has(node.value.toLowerCase())) {
          touchesBaseElement = true;
        }
      });
    }).processSync(selector);
  } catch {
    return false;
  }

  return bare && touchesBaseElement;
}

/**
 * Does this rule express a typographic decision, or merely neutralise a browser
 * default?
 *
 * Sites ship a normalize stylesheet ahead of their own, and its rules look
 * identical structurally — bare element selectors, familiar properties. Porting
 * them re-imposes browser defaults on the target: `h1 { font-size: 2em }` would
 * override the template's whole heading scale. A reset never states a colour or
 * a typeface; a design decision almost always does.
 */
function expressesTypography(decls) {
  return decls.some((d) => {
    const prop = d.prop.toLowerCase();
    if (prop === "color" || prop === "font-family" || prop === "font") return true;
    if (prop === "letter-spacing" || prop === "text-transform") return true;
    if (prop === "text-decoration" || prop === "text-decoration-line") return true;
    return false;
  });
}

/**
 * Collect the global element rules worth porting.
 *
 * Cascade order is preserved: these rules override each other exactly as they
 * did on the source, and reordering them produces typography that is correct
 * rule by rule and wrong in aggregate.
 */
export function collectBaseRules(rules, { rootPx } = {}) {
  const collected = [];

  for (const rule of rules) {
    if (isResetRule(rule)) continue;

    const selectors = rule.selectors.filter(isElementSelector);
    if (selectors.length === 0) continue;

    const decls = rule.decls.filter(
      (d) =>
        BASE_PROPERTIES.has(d.prop.toLowerCase()) && !isLegacyVendorDecl(d.prop, d.value)
    );
    if (decls.length === 0) continue;
    if (!expressesTypography(decls)) continue;

    collected.push({
      selectors,
      decls,
      atRuleChain: rule.atRuleChain,
      sheetUrl: rule.sheetUrl,
    });
  }

  return collected;
}

/**
 * Emit the ported rules.
 *
 * Wrapped in `@layer source-base`, which sits above the template's `base` so
 * ported typography wins, and below `components` so it never overrides a
 * component's own styling.
 */
export function emitSourceBase(collected, { assetMap = new Map(), layer = "source-base" } = {}) {
  if (collected.length === 0) return null;

  const unconditional = [];
  const byCondition = new Map();

  for (const rule of collected) {
    const body = rule.decls
      .map((d) => {
        const value =
          /url\(/i.test(d.value) && rule.sheetUrl
            ? rewriteUrls(d.value, rule.sheetUrl, assetMap)
            : d.value;
        return `    ${d.prop}: ${value};`;
      })
      .join("\n");

    const block = `  ${rule.selectors.join(",\n  ")} {\n${body}\n  }`;

    if (rule.atRuleChain.length === 0) {
      unconditional.push(block);
      continue;
    }
    // Group by condition so a media query is opened once, not per rule.
    const condition = rule.atRuleChain.join(" and ");
    if (!byCondition.has(condition)) byCondition.set(condition, []);
    byCondition.get(condition).push(block);
  }

  const parts = [
    "/* Global element styling ported from the source site.",
    "   Typography and rhythm only — layout stays the template's. */",
    `@layer ${layer} {`,
    unconditional.join("\n\n"),
  ];

  // Conditional rules come after the unconditional ones, matching the source.
  for (const [condition, blocks] of byCondition) {
    parts.push(`\n  ${condition} {\n${blocks.map((b) => "  " + b.replace(/\n/g, "\n  ")).join("\n\n")}\n  }`);
  }

  parts.push("}", "");
  return parts.join("\n");
}

/** Every asset the ported rules reference, for collection. */
export function assetsInBaseRules(collected) {
  const refs = new Set();
  for (const rule of collected) {
    for (const decl of rule.decls) {
      for (const { resolved } of urlsInValue(decl.value, rule.sheetUrl)) refs.add(resolved);
    }
  }
  return [...refs];
}
