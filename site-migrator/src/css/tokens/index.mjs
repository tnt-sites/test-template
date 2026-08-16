import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { loadStylesheets } from "../parse.mjs";
import { assertNoRootFontSize } from "../units.mjs";
import { serve } from "../../mirror/serve.mjs";
import {
  buildSelectorIndex,
  mergeIndexes,
  measureRoles,
  mergeMeasurements,
} from "../../browser/selector-index.mjs";
import { forEachPage } from "../../browser/load.mjs";
import {
  weighColors,
  clusterColors,
  assignRoles,
  extractHoverColors,
  baseElementColors,
  filterByArea,
} from "./palette.mjs";
import { retintRamp, parseRamp, emitRamp } from "./ramp.mjs";
import { extractIconGlyphs, iconFontFamily } from "../fonts.mjs";
import { converter } from "culori";

const converterOklch = converter("oklch");

/**
 * Stage 1: derive a full theme layer from the source site.
 *
 * This runs before any component work because every library component consumes
 * `--color-*` / `--font-*` custom properties. Getting the token layer right
 * restyles the entire component library at once, which is far cheaper than
 * correcting components one at a time afterwards.
 */

/** Pages to sample. A handful is enough and keeps the browser pass fast. */
function samplePages(pages, limit = 6) {
  const home = pages.find((p) => p.id === "index");
  const rest = pages.filter((p) => p.id !== "index");
  const step = Math.max(1, Math.floor(rest.length / (limit - 1)));
  const sampled = [home, ...rest.filter((_, i) => i % step === 0)].filter(Boolean);
  return sampled.slice(0, limit);
}

export async function runTokens(ctx, { sampleLimit = 6 } = {}) {
  const { config, preset, paths } = ctx;

  const mirrorDir = path.join(paths.artifacts, "instrumented");
  if (!fs.existsSync(mirrorDir)) throw new Error("No mirror found. Run `mig mirror` first.");

  const pagesFile = path.join(paths.artifacts, "pages.json");
  const { pages } = JSON.parse(fs.readFileSync(pagesFile, "utf8"));

  const css = await loadStylesheets(config.source.stylesheets, {
    mirrorDir,
    rootFontSizePx: config.source.rootFontSizePx,
  });

  if (css.rules.length === 0) {
    throw new Error(
      "No CSS rules parsed. Check `source.stylesheets` — it must list the site's stylesheets in cascade order."
    );
  }

  // Browser pass: rendered area per selector, plus measured role values.
  const { server, url: baseUrl } = await serve(mirrorDir, 0);
  const browser = await chromium.launch();
  const selectors = [...new Set(css.rules.flatMap((r) => r.selectors))];

  const indexes = [];
  const measurements = [];
  let failures = [];

  try {
    const sampled = samplePages(pages, sampleLimit).map((p) => ({
      ...p,
      url: `${baseUrl}/${p.id}.html`,
    }));

    const run = await forEachPage(
      browser,
      sampled,
      async (page) => {
        const idx = await buildSelectorIndex(page, selectors);
        measurements.push(
          await measureRoles(page, {
            contentRoots: config.segmentation.roots,
            chromeSelectors: Object.values(config.segmentation.chrome),
          })
        );
        return idx;
      },
      { viewport: { width: config.segmentation.viewport, height: 1000 } }
    );

    indexes.push(...run.results.map((r) => r.value));
    failures = run.failures;
  } finally {
    await browser.close();
    server.close();
  }

  if (indexes.length === 0) {
    throw new Error(
      `Could not measure any page. First failure: ${failures[0]?.reason ?? "unknown"}`
    );
  }

  const index = mergeIndexes(indexes);
  const measured = mergeMeasurements(measurements);

  // Palette.
  const weighted = weighColors(css.rules, index);
  const clustered = clusterColors(weighted, { maxDeltaE: config.tokens.colorMergeDeltaE });
  const significant = filterByArea(clustered, index.totalArea, config.tokens.minAreaShare);
  const hover = extractHoverColors(css.rules);
  const baseColors = baseElementColors(css.rules);
  const { roles, extras } = assignRoles(significant, measured, {
    hoverColors: hover,
    baseColors,
  });

  // Neutral ramp, retinted onto the measured page background.
  const rampFile = path.join(paths.targetRoot, preset.grayRampFile);
  let ramp = null;
  if (fs.existsSync(rampFile) && roles.bgPage) {
    const original = parseRamp(fs.readFileSync(rampFile, "utf8"));
    if (original.length) ramp = retintRamp(roles.bgPage, original);
  }

  // The source's icon font defines its whole icon vocabulary in one sheet.
  // Recording codepoint -> name lets content extraction resolve a `::before`
  // glyph back to a nameable icon instead of inheriting a template default.
  const iconGlyphs = {};
  let iconFamily = null;
  for (const sheet of css.iconFonts) {
    Object.assign(iconGlyphs, extractIconGlyphs(sheet.css));
    iconFamily = iconFamily ?? iconFontFamily(sheet.css);
  }
  if (Object.keys(iconGlyphs).length) {
    fs.mkdirSync(paths.artifacts, { recursive: true });
    fs.writeFileSync(
      path.join(paths.artifacts, "icon-glyphs.json"),
      JSON.stringify({ family: iconFamily, glyphs: iconGlyphs }, null, 2)
    );
  }

  const artifact = {
    generatedAt: new Date().toISOString(),
    rootFontSizePx: css.rootPx,
    remConversions: css.stats.converted,
    rootFontSizeRulesDropped: css.stats.dropped,
    roles,
    extras,
    baseColors,
    ramp,
    fontServices: css.fontServices,
    iconFonts: css.iconFonts.map((s) => s.url),
    iconGlyphCount: Object.keys(iconGlyphs).length,
    iconFamily,
    measured,
    pagesMeasured: indexes.length,
    pageFailures: failures.map((f) => ({ page: f.page.id, reason: f.reason })),
    palette: significant.slice(0, 24).map((c) => ({
      hex: c.hex,
      areaShare: index.totalArea ? +(c.area / index.totalArea).toFixed(5) : 0,
      occurrences: c.occurrences,
      props: [...c.props],
      merged: c.members.length,
    })),
  };

  const tokensDir = path.join(paths.artifacts, "tokens");
  fs.mkdirSync(tokensDir, { recursive: true });
  fs.writeFileSync(path.join(tokensDir, "palette.json"), JSON.stringify(artifact, null, 2));

  return { artifact, css, index };
}

/**
 * Emit `--src-*` custom properties for the whole extracted palette.
 *
 * Unlayered, for the same reason as the ramp: these are variable declarations
 * competing with the template's own unlayered variables, and an unlayered rule
 * always beats a layered one regardless of layer order.
 */
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

/**
 * Map the template's semantic colour variables onto source tokens.
 *
 * This covers the full semantic set, not just the slots the branding config
 * drives. Two of them (`--color-bg-accent`, `--color-bg-highlight`) are
 * hardcoded hexes in the theme that no branding value reaches, so a section set
 * to `backgroundColor: accent` keeps the template's placeholder colour unless
 * it is overridden here.
 */
export function emitSemanticOverrides(artifact) {
  const r = artifact.roles;
  const extras = artifact.extras ?? [];
  const pick = (...names) => names.map((n) => r[n]).find(Boolean);
  // Fall back to a real source colour rather than leaving a template placeholder.
  const orExtra = (value, i) => value ?? extras[i]?.hex;

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

  const decls = Object.entries(map)
    .filter(([, v]) => v)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n");

  // Emitted as a complete rule appended *after* the theme's own declarations.
  // Splicing these into the existing block would place them before the
  // template's defaults, and the later declaration wins — the tokens would look
  // right in the file and have no effect on the rendered site.
  return [":root,", '[data-theme="default"] {', decls, "}"].join("\n");
}

/**
 * Fill the branding config's slots from the extracted roles.
 *
 * The source site is authoritative here: whatever the starter template shipped
 * is a stand-in, so every slot the extraction can answer is answered. Slots
 * with no confident role fall back to the next-largest palette colour rather
 * than being left blank, because a blank slot resolves to the template's own
 * default and reintroduces the placeholder it was meant to replace.
 */
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

  // Text sitting on a brand-coloured surface: pick whichever of white/near-black
  // the source actually uses against the brand colour.
  if (r.brand) {
    patch.colorTextOnBrand = contrastTextFor(r.brand, extras);
  }

  const body = family(measured?.body);
  const heading = family(measured?.h2) ?? family(measured?.h1);
  if (body) patch.bodyFont = { fontFamily: measured.body["font-family"] };
  if (heading) {
    patch.headingsFont = { fontFamily: (measured.h2 ?? measured.h1)["font-family"] };
  }

  // Remote font services must be linked or the ported typography silently
  // falls back to a system font.
  if (artifact.fontServices.length) patch.fontLinks = artifact.fontServices;

  return patch;
}

/**
 * Choose readable text for a brand-coloured surface, preferring a colour the
 * source palette already contains over an invented one.
 */
function contrastTextFor(brandHex, extras) {
  const ok = toOklchLocal(brandHex);
  const light = (ok?.l ?? 0) > 0.6;
  const candidates = extras.map((e) => e.hex);

  if (light) {
    return candidates.find((h) => (toOklchLocal(h)?.l ?? 1) < 0.3) ?? "#000000";
  }
  return candidates.find((h) => (toOklchLocal(h)?.l ?? 0) > 0.9) ?? "#ffffff";
}

function toOklchLocal(hex) {
  return converterOklch(hex);
}
