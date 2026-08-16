import valueParser from "postcss-value-parser";
import { converter, formatHex, differenceEuclidean, parse as parseColor } from "culori";
import { areaForSelector } from "../../browser/selector-index.mjs";

const toOklch = converter("oklch");
const dE = differenceEuclidean("oklch");

/**
 * Extract the source site's real palette.
 *
 * The template's branding config exposes eight colour slots. Real sites use
 * more: a tinted page background, a header bar, a star gold, a border taupe.
 * Anything without a slot previously got hardcoded into a component by hand.
 * This produces a full token set instead, so every colour has a name.
 */

/** Properties whose values carry colours worth tokenising. */
const COLOR_PROPS = new Set([
  "color",
  "background",
  "background-color",
  "border-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "outline-color",
  "fill",
  "stroke",
]);

/**
 * Text covers far less of its box than a background does, so weighting both by
 * raw element area would rank body text alongside the page background.
 */
const TEXT_AREA_FACTOR = 0.15;

const NEUTRAL_CHROMA = 0.03;

/** Pull every colour literal out of a declaration value. */
export function colorsInValue(value) {
  const found = [];
  const parsed = valueParser(value);

  parsed.walk((node) => {
    if (node.type === "function" && /^(rgba?|hsla?|color|oklch|lab|lch)$/i.test(node.value)) {
      const text = valueParser.stringify(node);
      if (parseColor(text)) found.push(text);
      return false; // don't descend into the arguments
    }
    if (node.type === "word") {
      // Hex, or a named colour. Skip bare keywords that aren't colours.
      if (/^#[0-9a-f]{3,8}$/i.test(node.value)) {
        found.push(node.value);
      } else if (/^[a-z]+$/i.test(node.value) && !isNonColorKeyword(node.value)) {
        if (parseColor(node.value)) found.push(node.value);
      }
    }
    return undefined;
  });

  return found;
}

function isNonColorKeyword(word) {
  return /^(inherit|initial|unset|revert|none|transparent|currentcolor|auto|solid|dashed|dotted|double|groove|ridge|inset|outset|hidden|repeat|no-repeat|center|top|bottom|left|right|cover|contain|url|linear|radial|bold|normal|italic)$/i.test(
    word
  );
}

/**
 * Score every colour in the stylesheet by the area it actually covers.
 *
 * @param {Array} rules  parsed rules from `loadStylesheets`
 * @param {object} index merged selector index, or null to fall back to
 *                       occurrence counting when no browser pass has run
 */
export function weighColors(rules, index) {
  const scores = new Map(); // hex -> { area, occurrences, props:Set, selectors:Set }

  for (const rule of rules) {
    // Area is per-rule: all its selectors combined.
    let ruleArea = 0;
    if (index) {
      for (const sel of rule.selectors) ruleArea += areaForSelector(index, sel);
    }

    for (const decl of rule.decls) {
      const prop = decl.prop.toLowerCase();
      if (!COLOR_PROPS.has(prop) && !/^border(-\w+)?$/.test(prop) && prop !== "font") continue;

      const isText = prop === "color";
      const weight = isText ? ruleArea * TEXT_AREA_FACTOR : ruleArea;

      for (const raw of colorsInValue(decl.value)) {
        const parsed = parseColor(raw);
        if (!parsed) continue;
        if ((parsed.alpha ?? 1) === 0) continue; // fully transparent carries no colour

        const hex = formatHex(parsed);
        if (!hex) continue;

        if (!scores.has(hex)) {
          scores.set(hex, { hex, area: 0, occurrences: 0, props: new Set(), selectors: new Set() });
        }
        const entry = scores.get(hex);
        entry.area += weight;
        entry.occurrences += 1;
        entry.props.add(prop);
        for (const s of rule.selectors) entry.selectors.add(s);
      }
    }
  }

  return [...scores.values()];
}

/**
 * Merge perceptually indistinguishable colours.
 *
 * Sites accumulate near-duplicates (`#134545` and `#184D4D`) that are the same
 * intent. Merging in OKLCH collapses those while keeping genuine pairs apart —
 * a brand colour and its darker hover variant stay separate.
 */
export function clusterColors(weighted, { maxDeltaE = 0.025 } = {}) {
  const sorted = [...weighted].sort((a, b) => b.area - a.area || b.occurrences - a.occurrences);
  const clusters = [];

  for (const entry of sorted) {
    const ok = toOklch(entry.hex);
    if (!ok) continue;

    const home = clusters.find((c) => dE(toOklch(c.hex), ok) <= maxDeltaE);
    if (home) {
      home.area += entry.area;
      home.occurrences += entry.occurrences;
      home.members.push(entry.hex);
      for (const p of entry.props) home.props.add(p);
      for (const s of entry.selectors) home.selectors.add(s);
    } else {
      clusters.push({
        // Representative is the highest-area member's exact hex, so the token
        // is a colour the site really uses rather than a computed average.
        hex: entry.hex,
        area: entry.area,
        occurrences: entry.occurrences,
        members: [entry.hex],
        props: new Set(entry.props),
        selectors: new Set(entry.selectors),
      });
    }
  }

  return clusters.sort((a, b) => b.area - a.area || b.occurrences - a.occurrences);
}

export function isNeutral(hex) {
  const ok = toOklch(hex);
  return (ok?.c ?? 0) < NEUTRAL_CHROMA;
}

/**
 * Assign semantic roles from *measured* computed styles rather than guessing
 * from stylesheet frequency. The body's background is whatever the browser
 * actually painted, which is the only reliable definition.
 */
export function assignRoles(clusters, measured, { hoverColors = {}, baseColors = {} } = {}) {
  const roles = {};
  const used = new Set();

  const take = (name, ...candidates) => {
    const color = candidates.find(Boolean);
    if (!color) return;
    const hex = formatHex(parseColor(color) ?? {});
    if (!hex) return;
    roles[name] = hex;
    used.add(hex);
  };

  // Base rules first, measurement as the fallback. Measurement still governs
  // the page background, where the painted result is what actually matters.
  take("bgPage", measured?.body?.["background-color"]);
  take("text", baseColors.p, baseColors.body, measured?.paragraph?.color, measured?.body?.color);
  take("heading", baseColors.h2, baseColors.h1, measured?.h2?.color, measured?.h1?.color);
  take("link", baseColors.a, measured?.link?.color);
  take("linkHover", hoverColors.link);

  // Brand candidates: non-neutral colours used as a background on more than one
  // selector — a one-off accent shouldn't claim the brand slot.
  //
  // Only the page background and body/heading text are disqualified. A colour
  // already serving as, say, the link hover can still be the secondary brand
  // colour; sites reuse one palette across roles, and excluding every assigned
  // colour leaves the brand slots duplicating whatever happens to be left.
  const notBrand = new Set([roles.bgPage, roles.text, roles.heading].filter(Boolean));

  const brandish = clusters.filter(
    (c) =>
      !isNeutral(c.hex) &&
      !notBrand.has(c.hex) &&
      c.selectors.size >= 2 &&
      [...c.props].some((p) => p.startsWith("background"))
  );

  if (brandish[0]) take("brand", brandish[0].hex);
  if (brandish[1]) take("brandSecondary", brandish[1].hex);
  if (brandish[2]) take("brandMuted", brandish[2].hex);
  if (brandish[3]) take("brandSubtle", brandish[3].hex);

  // Everything else that carries meaningful area gets a numbered token, so no
  // colour is left without a name to reference.
  const extras = clusters
    .filter((c) => !used.has(c.hex))
    .slice(0, 12)
    .map((c, i) => ({ name: `color${i + 1}`, hex: c.hex, area: c.area }));

  return { roles, extras };
}

/**
 * Read colours straight off bare-element rules (`a { color }`, `p { color }`).
 *
 * For base tokens the stylesheet is the authority, not measurement. `a { color:
 * #751414 }` *is* the definition of the default link colour, whereas the
 * area-dominant link colour across rendered pages is noisy — plenty of links
 * live inside cards, service grids and callouts that restyle them, and on some
 * pages those outweigh body copy.
 *
 * Later rules win, matching the cascade.
 */
export function baseElementColors(rules) {
  const out = {};
  const wanted = new Set(["a", "p", "body", "h1", "h2", "h3"]);

  for (const rule of rules) {
    // Only unconditional, single bare-tag rules define a base value.
    if (rule.atRuleChain.length > 0) continue;
    if (rule.selectors.length !== 1) continue;

    const sel = rule.selectors[0].trim().toLowerCase();
    if (!wanted.has(sel)) continue;

    for (const decl of rule.decls) {
      const prop = decl.prop.toLowerCase();
      if (prop !== "color" && prop !== "font") continue;
      if (prop === "font") continue; // the `font` shorthand carries no colour

      const raw = colorsInValue(decl.value)[0];
      if (!raw) continue;
      const hex = formatHex(parseColor(raw) ?? {});
      if (hex) out[sel] = hex;
    }
  }

  return out;
}

/** Recover `:hover` colours, which computed style cannot report. */
export function extractHoverColors(rules) {
  const out = {};
  for (const rule of rules) {
    for (const sel of rule.selectors) {
      if (!/:hover\b/.test(sel)) continue;
      const base = sel.replace(/:hover\b/g, "").trim();
      const decl = rule.decls.find((d) => d.prop.toLowerCase() === "color");
      if (!decl) continue;
      const hex = formatHex(parseColor(colorsInValue(decl.value)[0] ?? "") ?? {});
      if (!hex) continue;
      if (base === "a" && !out.link) out.link = hex;
      out[base] = out[base] ?? hex;
    }
  }
  return out;
}

/** Drop clusters too small to be worth a token. */
export function filterByArea(clusters, totalArea, minShare) {
  if (!totalArea) return clusters;
  return clusters.filter((c) => c.area / totalArea >= minShare || c.occurrences >= 5);
}

export { toOklch, dE };
