/**
 * Pure emission from an extracted colour/type artifact into the
 * cloudcannon-astro-starter's own token/data schema. Ported from
 * site-migrator's css/tokens/index.mjs, stripped of its Playwright-driven
 * `runTokens` orchestration — wp-migrator drives its own browser pass and
 * hands the resulting artifact to these functions.
 */

import { converter } from "culori";
import { assertNoRootFontSize } from "../units.mjs";

const converterOklch = converter("oklch");

/** Emit `--src-*` custom properties for the whole extracted palette. */
export function emitTokens(artifact) {
  const lines = [":where(:root) {"];

  const roleVar = {
    bgPage: "--src-bg-page",
    text: "--src-text",
    heading: "--src-heading",
    link: "--src-link",
    linkHover: "--src-link-hover",
    brand: "--src-brand",
    brandSecondary: "--src-brand-secondary",
    brandMuted: "--src-brand-muted",
    brandSubtle: "--src-brand-subtle",
  };

  for (const [role, hex] of Object.entries(artifact.roles)) {
    const name = roleVar[role] ?? `--src-${role}`;
    lines.push(`  ${name}: ${hex};`);
  }
  for (const extra of artifact.extras) {
    lines.push(`  --src-${extra.name}: ${extra.hex};`);
  }

  lines.push("}", "");
  const css = lines.join("\n");
  assertNoRootFontSize(css, "generated token layer");
  return css;
}

/** Map the template's semantic colour variables onto source tokens. */
export function emitSemanticOverrides(artifact) {
  const r = artifact.roles;
  const extras = artifact.extras ?? [];
  const pick = (...names) => names.map((n) => r[n]).find(Boolean);
  const orExtra = (value, i) => value ?? extras[i]?.hex;

  // Body type is measured (`measureRoles` reads `font-size` for every role) but
  // was never written anywhere, so every migrated page inherited the starter's
  // `--font-size-md: 1rem`. On a source that sets 18px that is a 2px deficit on
  // every paragraph and list item on the site — which is not merely "slightly
  // small text": ~12% less text fits per line, so every block reflows taller
  // and the whole page grows. It read as mysterious vertical gaps rather than
  // as a font-size problem, because the headings looked perfect: those are
  // baked per component from their own measurement, while body copy falls
  // through to the token.
  const bodySize = fontSize(artifact.measured?.paragraph) ?? fontSize(artifact.measured?.body);

  const map = {
    "--color-bg": r.bgPage,
    "--color-text": r.text,
    "--color-text-strong": r.heading,
    "--color-link": r.link,
    "--color-link-hover": r.linkHover,
    "--color-brand": r.brand,
    "--color-brand-secondary": r.brandSecondary,
    "--color-brand-muted": pick("brandMuted", "brandSecondary"),
    "--color-brand-subtle": pick("brandSubtle", "brandSecondary"),
    "--color-bg-accent": orExtra(pick("brandSubtle", "brandMuted"), 0),
    "--color-bg-highlight": orExtra(pick("brandMuted", "brandSubtle"), 1),
  };

  // Expressed in rem against the *source's* root size, not a presumed 16 — a
  // theme that sets `html { font-size: 62.5% }` would otherwise get a base
  // several times too large.
  const rootPx = artifact.rootFontSizePx || 16;
  if (bodySize && Math.abs(bodySize - rootPx) > 0.5) {
    map["--font-size-md"] = `${Math.round((bodySize / rootPx) * 1000) / 1000}rem`;
  }

  const decls = Object.entries(map)
    .filter(([, v]) => v)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n");

  return [":root,", '[data-theme="default"] {', decls, "}"].join("\n");
}

/** Fill the branding config's slots from the extracted roles. */
export function brandingPatch(artifact, measured) {
  const r = artifact.roles;
  const extras = artifact.extras ?? [];
  const family = (m) => m?.["font-family"]?.split(",")[0]?.replace(/["']/g, "").trim();

  const spare = extras.map((e) => e.hex);
  const nextSpare = () => spare.shift();

  const patch = {};
  if (r.brand) patch.colorBrand = r.brand;
  if (r.brandSecondary) patch.colorBrandSecondary = r.brandSecondary;
  if (r.brandMuted ?? r.brandSecondary) patch.colorBrandTertiary = r.brandMuted ?? r.brandSecondary;

  const subtle = r.brandSubtle ?? nextSpare();
  if (subtle) patch.colorBrandSubtle = subtle;

  if (r.link) patch.colorLink = r.link;
  if (r.linkHover) patch.colorLinkHover = r.linkHover;

  if (r.brand) {
    patch.colorTextOnBrand = contrastTextFor(r.brand, extras);
  }

  const body = family(measured?.body);
  const heading = family(measured?.h2) ?? family(measured?.h1);
  if (body) patch.bodyFont = { fontFamily: measured.body["font-family"] };
  if (heading) {
    patch.headingsFont = { fontFamily: (measured.h2 ?? measured.h1)["font-family"] };
  }

  if (artifact.fontServices.length) patch.fontLinks = artifact.fontServices;

  return patch;
}

/**
 * A role's measured `font-size` in px, or null.
 *
 * Only a plain `px` value counts: a role reported in `em` is relative to
 * whatever it inherited, which is the thing being set here — using it would
 * define the base in terms of itself.
 */
function fontSize(role) {
  const raw = role?.["font-size"];
  const px = /^([\d.]+)px$/.exec(String(raw ?? "").trim());

  return px ? Math.round(parseFloat(px[1]) * 100) / 100 : null;
}

function contrastTextFor(brandHex, extras) {
  const ok = converterOklch(brandHex);
  const light = (ok?.l ?? 0) > 0.6;
  const candidates = extras.map((e) => e.hex);

  if (light) {
    return candidates.find((h) => (converterOklch(h)?.l ?? 1) < 0.3) ?? "#000000";
  }
  return candidates.find((h) => (converterOklch(h)?.l ?? 0) > 0.9) ?? "#ffffff";
}
