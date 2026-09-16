/**
 * Resolve a captured source icon name to an icon the target project actually
 * ships.
 *
 * Icon fonts are the one asset class that genuinely cannot be carried across:
 * the glyph lives in a font file that is often a paid kit served from a CDN
 * (`kit.fontawesome.com`), and even when the font *is* mirrorable, shipping a
 * whole icon font to render six glyphs is worse than using the icon set the
 * target already has. So this substitutes rather than ports — the one place in
 * the tool where an equivalent asset is preferred over the original.
 *
 * Matching is deliberately conservative: an exact or near-exact name wins, and
 * a weak token overlap returns null so the caller can report an unresolved
 * icon rather than silently render something misleading.
 */

import fs from "node:fs";
import path from "node:path";

/**
 * Read the target's icon set once. Names are paths relative to the icon dir
 * without the extension, matching how `astro-icon` addresses them
 * (`social/facebook`, `check-circle-duo`).
 */
export function loadIconSet(targetRoot, iconDir = "src/icons") {
  const root = path.join(targetRoot, iconDir);
  if (!fs.existsSync(root)) return [];
  const out = [];
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name), `${prefix}${entry.name}/`);
      else if (entry.name.endsWith(".svg"))
        out.push(`${prefix}${entry.name.replace(/\.svg$/, "")}`);
    }
  };
  walk(root, "");
  return out;
}

const tokens = (name) => name.split(/[-/]/).filter(Boolean);

/**
 * Font Awesome names that no amount of token shuffling reaches, because the
 * two sets simply call the thing something different.
 *
 * The fuzzy pass requires every source token to appear in the target name,
 * which is what stops it inventing matches — and is also why `map-marker`
 * never finds `map-pin`, `search` never finds `magnifying-glass`, and `bars`
 * never finds `bars-3`. Those are the icons chrome is built out of, so a
 * migrated header loses its hamburger and a footer loses the pin beside its
 * address while every other icon on the page resolves fine.
 *
 * Kept to genuine synonyms for the same glyph. Anything approximate belongs in
 * the unresolved report, where a human can see it.
 */
const SYNONYMS = {
  "map-marker": ["map-pin"],
  "map-marker-alt": ["map-pin"],
  "location-dot": ["map-pin"],
  search: ["magnifying-glass"],
  bars: ["bars-3"],
  navicon: ["bars-3"],
  times: ["x-mark"],
  xmark: ["x-mark"],
  close: ["x-mark"],
  "phone-volume": ["phone"],
  mobile: ["device-phone-mobile"],
  "mobile-alt": ["device-phone-mobile"],
  "envelope-open-text": ["envelope-open"],
  calendar: ["calendar-days"],
  "calendar-alt": ["calendar-days"],
  "calendar-check": ["calendar-days"],
  "external-link": ["arrow-top-right-on-square"],
  "external-link-alt": ["arrow-top-right-on-square"],
  directions: ["map"],
  comments: ["chat-bubble-left-right"],
  comment: ["chat-bubble-left"],
  "info-circle": ["information-circle"],
  twitter: ["x"],
  "twitter-square": ["x"],
};

/**
 * Font Awesome orders some compound names differently from most icon sets
 * ("arrow-circle-right" vs "arrow-right-circle"). Rather than hardcode pairs,
 * try the token permutations that shuffle a shape word to the end.
 */
const SHAPE_WORDS = new Set(["circle", "square", "box"]);

function candidates(sourceName, { duotone }) {
  const base = sourceName.toLowerCase().replace(/^fa-/, "");
  const t = tokens(base);
  const set = new Set([base]);

  // Move a shape word to the end: arrow-circle-right -> arrow-right-circle
  for (const shape of SHAPE_WORDS) {
    const i = t.indexOf(shape);
    if (i > -1 && i < t.length - 1) {
      const reordered = [...t.slice(0, i), ...t.slice(i + 1), shape];
      set.add(reordered.join("-"));
    }
  }

  // Common FA suffixes the target set is unlikely to use.
  for (const v of [...set]) {
    set.add(v.replace(/-(o|alt|solid|regular|light)$/, ""));
  }

  // Named synonyms, added after the suffix pass so `map-marker-alt` reaches
  // them both directly and via `map-marker`.
  for (const v of [...set]) {
    for (const synonym of SYNONYMS[v] ?? []) set.add(synonym);
  }

  // A duotone source icon prefers a duotone-style target icon when one exists;
  // the previous hand migration created exactly these (`check-circle-duo`).
  const withDuo = [];
  if (duotone) for (const v of set) withDuo.push(`${v}-duo`);

  return [...withDuo, ...set];
}

/**
 * @param {{name:string, family?:string}} icon captured icon identity
 * @param {string[]} iconSet available target icon names
 * @returns {{name:string, confidence:"exact"|"variant"|"fuzzy"}|null}
 */
export function resolveIcon(icon, iconSet) {
  if (!icon?.name || !iconSet.length) return null;
  const duotone = icon.family === "fad";
  const bySuffix = new Map();
  for (const available of iconSet) {
    bySuffix.set(available, available);
    const leaf = available.split("/").pop();
    if (!bySuffix.has(leaf)) bySuffix.set(leaf, available);
  }

  const list = candidates(icon.name, { duotone });
  for (const [i, candidate] of list.entries()) {
    const hit = bySuffix.get(candidate);
    if (hit)
      return { name: hit, confidence: i === 0 && candidate === icon.name ? "exact" : "variant" };
  }

  /*
   * Brand icons live under social/ in this project's convention.
   *
   * Tried across the whole candidate list, not just the raw name: Font
   * Awesome's brand glyphs carry a shape suffix the icon set does not
   * (`fa-facebook-square`, `fa-twitter-square`), so matching only
   * `social/facebook-square` misses the `social/facebook` that is sitting
   * right there. A footer's social row is exactly where this shows up.
   */
  const brands = new Set(list);
  for (const v of [...brands]) brands.add(v.replace(/-(square|f|official|circle)$/, ""));
  for (const candidate of brands) {
    const brandHit = bySuffix.get(`social/${candidate}`);
    if (brandHit) return { name: brandHit, confidence: "variant" };
  }

  // Last resort: strong token overlap. Requires every source token to appear
  // in the candidate, so "envelope" can match "envelope-open" but "check" will
  // not match an unrelated icon that merely shares a word.
  const st = tokens(icon.name);
  let best = null;
  for (const available of iconSet) {
    const at = tokens(available.split("/").pop());
    if (!st.every((tok) => at.includes(tok))) continue;
    const score = st.length / at.length;
    if (!best || score > best.score) best = { name: available, score };
  }
  if (best && best.score >= 0.5) return { name: best.name, confidence: "fuzzy" };

  return null;
}

/** Annotate every node in a captured tree that carries an icon identity. */
export function resolveTreeIcons(tree, iconSet) {
  const unresolved = [];
  const resolved = [];
  const walk = (node) => {
    if (node.icon) {
      const hit = resolveIcon(node.icon, iconSet);
      if (hit) {
        node.iconName = hit.name;
        node.iconConfidence = hit.confidence;
        resolved.push({ from: node.icon.name, to: hit.name, confidence: hit.confidence });
      } else {
        unresolved.push(node.icon.name);
      }
    }
    for (const c of node.children || []) walk(c);
    if (node.array?.template) walk(node.array.template);
  };
  walk(tree);
  return { resolved, unresolved };
}
