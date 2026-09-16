/**
 * The colour vocabulary editors pick from in CloudCannon.
 *
 * Components expose colours as a `select` over the site's brand tokens plus
 * black/white/dark rather than a raw hex picker, so a site-wide rebrand in
 * branding.json flows through every migrated section. Each option's `id` is
 * the literal CSS value the component drops into its custom property, so the
 * select needs no lookup table on the Astro side.
 *
 * A companion `<name>Hex` colour input stays available as an escape hatch for
 * the one-off shade the palette can't express; when set it wins.
 */

import fs from "node:fs";
import path from "node:path";

/** The palette, in the order editors see it. */
export const COLOR_OPTIONS = [
  { id: "", name: "Default" },
  { id: "var(--color-brand)", name: "Brand (Primary)" },
  { id: "var(--color-brand-secondary)", name: "Brand (Secondary)" },
  { id: "var(--color-brand-muted)", name: "Brand (Tertiary)" },
  { id: "var(--color-brand-subtle)", name: "Brand (Subtle)" },
  { id: "var(--color-text-on-brand)", name: "Text on Brand" },
  { id: "var(--color-link)", name: "Link" },
  { id: "var(--color-link-hover)", name: "Link Hover" },
  { id: "#ffffff", name: "White" },
  { id: "#1a1a1a", name: "Dark" },
  { id: "#000000", name: "Black" },
];

/** Concrete hexes for the palette entries that aren't branding-dependent. */
const LITERALS = {
  "#ffffff": "#ffffff",
  "#1a1a1a": "#1a1a1a",
  "#000000": "#000000",
};

/**
 * Branding hexes, keyed by the option id that resolves to them. Populated from
 * the target repo's branding.json so a measured colour can snap to a brand
 * token instead of being frozen as a hex.
 */
export function brandLiterals(branding = {}) {
  const map = {
    "var(--color-brand)": branding.colorBrand,
    "var(--color-brand-secondary)": branding.colorBrandSecondary,
    "var(--color-brand-muted)": branding.colorBrandTertiary,
    "var(--color-brand-subtle)": branding.colorBrandSubtle,
    "var(--color-text-on-brand)": branding.colorTextOnBrand,
    "var(--color-link)": branding.colorLink,
    "var(--color-link-hover)": branding.colorLinkHover,
  };
  for (const [k, v] of Object.entries(map)) if (!v || !String(v).trim()) delete map[k];
  return map;
}

const hex3to6 = (h) => (h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h);

function rgbOf(value) {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  const hexMatch = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hexMatch) {
    const h = hex3to6(v);
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }
  const rgbMatch = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  if (rgbMatch) return [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])];
  return null;
}

/**
 * A measured colour as a hex literal.
 *
 * Computed styles come back as `rgb(244, 248, 247)`, which is correct CSS but
 * reads badly in a page's front matter and does not match the `#rrggbb` every
 * other emitted colour prop uses. Anything that is not a plain opaque colour —
 * a `var()`, a gradient, `transparent`, a translucent `rgba()` — is returned
 * untouched.
 */
export function toHex(value) {
  const rgb = rgbOf(value);
  if (!rgb) return typeof value === "string" ? value : "";
  const alpha = String(value).match(/^rgba\([^)]*,\s*([\d.]+)\s*\)$/);
  if (alpha && Number(alpha[1]) < 1) return String(value);
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

/** Every `rgb()`/`rgba()` inside a compound value (a border shorthand) as hex. */
export function hexifyCss(value) {
  return String(value || "").replace(/rgba?\([^)]*\)/g, (m) => toHex(m));
}

/**
 * The palette option a measured colour should default to.
 *
 * Only a near-exact match snaps — an approximate one would silently restyle
 * the migrated page. Anything else defaults to "" (the component's own baked
 * default) with the measured hex parked in the `<name>Hex` override so the
 * section still renders exactly as captured.
 */
export function nearestOption(value, branding = {}, tolerance = 12) {
  const target = rgbOf(value);
  if (!target) return null;
  const candidates = { ...LITERALS, ...brandLiterals(branding) };
  let best = null;
  for (const [id, hex] of Object.entries(candidates)) {
    const rgb = rgbOf(hex);
    if (!rgb) continue;
    const dist = Math.sqrt(
      (target[0] - rgb[0]) ** 2 + (target[1] - rgb[1]) ** 2 + (target[2] - rgb[2]) ** 2
    );
    if (!best || dist < best.dist) best = { id, dist };
  }
  return best && best.dist <= tolerance ? best.id : null;
}

/** The target repo's branding.json, or `{}` when it isn't there / won't parse. */
export function loadBranding(targetRoot) {
  try {
    const file = path.join(targetRoot, "src/data/branding.json");
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}
