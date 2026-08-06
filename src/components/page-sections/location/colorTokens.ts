/**
 * The color choices offered on each location section's `backgroundColor`,
 * `headingColor`, and `textColor` CloudCannon selects (the latter two share
 * one vocabulary — LOCATION_TEXT_COLORS). Keys match the `id` values declared
 * in cloudcannon.config.yml's `_select_data.locationBackgroundColors` /
 * `_select_data.locationTextColors` — keep the two in sync if you add options.
 *
 * These resolve to the site's existing theme tokens (which branding.json
 * already drives), plus plain black/white for cases that shouldn't move with
 * the brand palette. An unset/unknown id resolves to `undefined`, which
 * leaves the section's own default styling untouched.
 */

export const LOCATION_BACKGROUND_COLORS: Record<string, string> = {
  base: "var(--color-bg)",
  surface: "var(--color-bg-surface)",
  accent: "var(--color-bg-accent)",
  highlight: "var(--color-bg-highlight)",
  brand: "var(--color-bg-brand)",
  "brand-secondary": "var(--color-bg-brand-secondary)",
  "brand-muted": "var(--color-bg-brand-muted)",
  dark: "var(--color-bg-dark)",
  black: "var(--color-bg-black)",
  white: "#ffffff",
};

export const LOCATION_TEXT_COLORS: Record<string, string> = {
  brand: "var(--color-brand)",
  "brand-secondary": "var(--color-brand-secondary)",
  "brand-muted": "var(--color-brand-muted)",
  "brand-subtle": "var(--color-brand-subtle)",
  "text-on-brand": "var(--color-text-on-brand)",
  text: "var(--color-text)",
  "text-strong": "var(--color-text-strong)",
  black: "#000000",
  white: "#ffffff",
};

export function resolveBackgroundColor(id: unknown): string | undefined {
  return typeof id === "string" ? LOCATION_BACKGROUND_COLORS[id] : undefined;
}

export function resolveTextColor(id: unknown): string | undefined {
  return typeof id === "string" ? LOCATION_TEXT_COLORS[id] : undefined;
}
