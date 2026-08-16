import { converter, formatHex } from "culori";

const toOklch = converter("oklch");

/**
 * Regenerate the template's neutral ramp in the source site's own hue.
 *
 * Component libraries build every surface, border and muted text colour out of
 * a neutral `--gray-*` scale. When the source site's background is a tinted
 * neutral (cream, warm grey, cool slate) rather than pure white, leaving that
 * scale untouched leaves every component subtly the wrong colour — and the
 * branding config has no slot for it, so the only remedy was retinting all
 * thirteen stops by hand.
 *
 * The transform, derived by fitting a hand-retinted ramp:
 *   L_i = anchorL * (originalL_i / originalL_0)   lightness scales, not held
 *   C_i = anchorC * (L_i / anchorL) ** falloff    chroma fades toward black
 *   h_i = anchorH                                 one hue throughout
 *
 * Endpoints are pinned: stop 0 is the anchor exactly (it is the most visible
 * surface on the site) and a pure-black final stop stays pure black.
 */

const DEFAULT_FALLOFF = 1.0;

/** Parse `--gray-N: #hex;` declarations out of a stylesheet. */
export function parseRamp(css) {
  const stops = [];
  for (const m of css.matchAll(/--gray-(\d+)\s*:\s*([^;]+);/g)) {
    stops[Number(m[1])] = m[2].trim();
  }
  return stops.filter(Boolean);
}

/**
 * @param {string} anchorColor  the source's dominant neutral (usually the
 *                              computed `background-color` of `body`)
 * @param {string[]} originalRamp  the template's existing ramp, light to dark
 */
export function retintRamp(anchorColor, originalRamp, { falloff = DEFAULT_FALLOFF } = {}) {
  const anchor = toOklch(anchorColor);
  if (!anchor) throw new Error(`Unparseable anchor colour: ${anchorColor}`);

  const original = originalRamp.map((c) => toOklch(c));
  const topL = original[0]?.l;
  if (!topL) throw new Error("Original ramp's first stop has no lightness");

  const anchorC = anchor.c ?? 0;
  const anchorH = anchor.h ?? 0;

  return originalRamp.map((originalHex, i) => {
    // Pin the lightest stop to the measured colour exactly.
    if (i === 0) return normalizeHex(anchorColor);

    // A pure-black endpoint carries no hue to tint.
    const isBlackEnd = i === originalRamp.length - 1 && (original[i].l ?? 0) < 0.001;
    if (isBlackEnd) return normalizeHex(originalHex);

    const l = anchor.l * ((original[i].l ?? 0) / topL);
    const c = Math.min(anchorC, anchorC * Math.pow(l / anchor.l, falloff));

    return formatHex({ mode: "oklch", l, c, h: anchorH });
  });
}

function normalizeHex(color) {
  return formatHex(toOklch(color)) ?? color;
}

/**
 * Emit the retinted ramp as a stylesheet that overrides without editing the
 * original.
 *
 * Deliberately unlayered. The template declares its own ramp outside any
 * cascade layer, and unlayered styles beat layered ones no matter where the
 * layer sits in the order — wrapping this in `@layer` produces a file that
 * looks correct and has no effect. These are custom-property declarations, so
 * source order is the right mechanism: imported after the template's, they win.
 */
export function emitRamp(stops) {
  const decls = stops.map((hex, i) => `  --gray-${i}: ${hex};`).join("\n");
  return [
    "/* Neutral ramp retinted to the source site's own hue. Overrides",
    "   variables/_colors.pcss by source order, without editing it. */",
    ":where(:root) {",
    decls,
    "}",
    "",
  ].join("\n");
}

export { toOklch };
