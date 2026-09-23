/**
 * Site-wide extraction: colors/fonts (the token pipeline), chrome/site-info
 * (nav, footer, address, hours, socials), SEO, and the image inventory.
 *
 * This is the part of wp-migrator that answers the original ask directly:
 * scan the rendered WordPress site and land images, fonts, colors, and site
 * info in the CloudCannon repo's correct spots. Section/component generation
 * (capture/, detect/, generate/) is a separate concern built on top of the
 * same browser primitives.
 */

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { crawlLocal } from "../mirror/crawl.mjs";
import { serve } from "../mirror/serve.mjs";
import { gotoStable, forEachPage } from "../browser/load.mjs";
import { buildMeasurementMirror } from "./mirror.mjs";
import { discoverStylesheets } from "./stylesheets.mjs";
import { loadStylesheets } from "../css/parse.mjs";
import { buildSelectorIndex, mergeIndexes, measureRoles, mergeMeasurements } from "../browser/selector-index.mjs";
import {
  weighColors,
  clusterColors,
  assignRoles,
  extractHoverColors,
  baseElementColors,
  filterByArea,
} from "../css/tokens/palette.mjs";
import { retintRamp, parseRamp, emitRamp } from "../css/tokens/ramp.mjs";
import { extractIconGlyphs, iconFontFamily } from "../css/fonts.mjs";
import { copyFonts } from "./fonts.mjs";
import { extractChrome } from "../chrome/extract.mjs";
import { buildNavData, buildFooterData, buildSiteInfo, collectChromeAssets, countNav } from "../chrome/build.mjs";
import { extractSeo, detectTitleSuffix, stripTitleSuffix } from "../content/seo.mjs";

/** Home + evenly spaced rest, matching site-migrator's tokens sampler. */
function samplePages(pages, limit = 6) {
  const home = pages.find((p) => p.id === "index");
  const rest = pages.filter((p) => p.id !== "index");
  const step = Math.max(1, Math.floor(rest.length / (limit - 1)));
  const sampled = [home, ...rest.filter((_, i) => i % step === 0)].filter(Boolean);
  return sampled.slice(0, limit);
}

const GENERIC_CHROME = {
  header: 'header, [role="banner"], #masthead, .site-header, #header, .header, .main-header',
  footer: 'footer, [role="contentinfo"], #colophon, .site-footer, #footer',
};
const BUTTON_CLASS_PATTERN = "^(btn|button)(-\\w+)?$";

function COLLECT_IMAGES() {
  const urls = new Set();
  for (const img of document.querySelectorAll("img[src]")) urls.add(img.getAttribute("src"));
  for (const source of document.querySelectorAll("source[srcset]")) {
    for (const part of (source.getAttribute("srcset") || "").split(",")) {
      const url = part.trim().split(/\s+/)[0];
      if (url) urls.add(url);
    }
  }
  for (const el of document.querySelectorAll("[style*=background]")) {
    const m = (el.getAttribute("style") || "").match(/background(?:-image)?\s*:[^;]*url\(["']?([^"')]+)["']?\)/i);
    if (m) urls.add(m[1]);
  }
  return [...urls];
}

/**
 * @param {object} opts
 * @param {string} opts.staticDir  local snapshot root (site-migrator/tools/snapshot.mjs output shape: flat *.html + verbatim asset tree)
 * @param {string} opts.targetRoot  CloudCannon repo root
 * @param {import("../fs/write.mjs").Writer} opts.writer
 * @param {number} [opts.sampleLimit]
 */
export async function runExtract({ staticDir, targetRoot, writer, sampleLimit = 6, workDir }) {
  const allPages = crawlLocal(staticDir);
  if (allPages.length === 0) throw new Error(`No pages found under ${staticDir}`);
  const sampled = samplePages(allPages, sampleLimit);

  // Instrumenting is a cheap, pure text transform, so the whole page set is
  // mirrored here (not just the sample) — the same served directory is reused
  // below for the full-site SEO/image sweep, which needs every page present.
  const mirrorDir = workDir ?? path.join(staticDir, "..", ".wpmig-mirror");
  buildMeasurementMirror(staticDir, mirrorDir, allPages);

  const { server, url: baseUrl } = await serve(mirrorDir, 0);
  const browser = await chromium.launch();

  const report = { pages: allPages.length, sampled: sampled.length, warnings: [] };

  try {
    // ---- stylesheet discovery + selector index + role measurement --------
    const sheetUrlSet = new Set();
    const indexes = [];
    const measurements = [];
    const selectorPage = await browser.newPage({ viewport: { width: 1280, height: 1000 } });

    for (const p of sampled) {
      const state = await gotoStable(selectorPage, `${baseUrl}/${p.id}.html`, { primeLazyLoad: true, reveal: true });
      if (!state.ok) {
        report.warnings.push(`sample page ${p.id}: ${state.reason}`);
        continue;
      }
      for (const url of await discoverStylesheets(selectorPage)) sheetUrlSet.add(url);
    }
    await selectorPage.close();

    const sheetUrls = [...sheetUrlSet];
    const css = await loadStylesheets(sheetUrls, { mirrorDir, rootFontSizePx: "auto" });
    if (css.rules.length === 0) {
      report.warnings.push("no CSS rules parsed — colors/fonts will be empty");
    }
    const selectors = [...new Set(css.rules.flatMap((r) => r.selectors))];

    const run = await forEachPage(
      browser,
      sampled.map((p) => ({ ...p, url: `${baseUrl}/${p.id}.html` })),
      async (page) => {
        const idx = await buildSelectorIndex(page, selectors);
        measurements.push(
          await measureRoles(page, { contentRoots: ["body"], chromeSelectors: Object.values(GENERIC_CHROME) })
        );
        return idx;
      },
      { viewport: { width: 1280, height: 1000 } }
    );
    indexes.push(...run.results.map((r) => r.value));
    for (const f of run.failures) report.warnings.push(`measure ${f.page.id}: ${f.reason}`);

    const index = indexes.length ? mergeIndexes(indexes) : { selectorUids: new Map(), areaByUid: new Map(), totalArea: 0, elementCount: 0 };
    const measured = mergeMeasurements(measurements);

    // ---- palette -----------------------------------------------------------
    const weighted = weighColors(css.rules, index.totalArea ? index : null);
    const clustered = clusterColors(weighted, { maxDeltaE: 0.025 });
    const significant = filterByArea(clustered, index.totalArea, 0.002);
    const hover = extractHoverColors(css.rules);
    const baseColors = baseElementColors(css.rules);
    const { roles, extras } = assignRoles(significant, measured, { hoverColors: hover, baseColors });

    let ramp = null;
    const rampFile = path.join(targetRoot, "src/styles/variables/_colors.pcss");
    if (fs.existsSync(rampFile) && roles.bgPage) {
      const original = parseRamp(fs.readFileSync(rampFile, "utf8"));
      if (original.length) ramp = retintRamp(roles.bgPage, original);
    }

    const iconGlyphs = {};
    let iconFamily = null;
    for (const sheet of css.iconFonts) {
      Object.assign(iconGlyphs, extractIconGlyphs(sheet.css));
      iconFamily = iconFamily ?? iconFontFamily(sheet.css);
    }

    const artifact = {
      generatedAt: new Date().toISOString(),
      rootFontSizePx: css.rootPx,
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
      palette: significant.slice(0, 24).map((c) => ({
        hex: c.hex,
        areaShare: index.totalArea ? +(c.area / index.totalArea).toFixed(5) : 0,
        occurrences: c.occurrences,
      })),
    };

    // ---- fonts: copy binaries alongside the sheets that reference them ----
    const fontResult = copyFonts(css.sheets, { staticDir, writer, publicDir: "public" });
    if (fontResult.missing.length) {
      report.warnings.push(`${fontResult.missing.length} font file(s) referenced but not found in the snapshot`);
    }

    // ---- chrome / site info -------------------------------------------------
    const chromePage = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const homeId = sampled.find((p) => p.id === "index")?.id ?? sampled[0].id;
    const chromeState = await gotoStable(chromePage, `${baseUrl}/${homeId}.html`, { primeLazyLoad: true, reveal: true });
    let extracted = null;
    if (chromeState.ok) {
      extracted = await extractChrome(chromePage, { chrome: GENERIC_CHROME, buttonClassPattern: BUTTON_CLASS_PATTERN });
    } else {
      report.warnings.push(`chrome page ${homeId}: ${chromeState.reason}`);
    }
    await chromePage.close();

    // ---- full-site sweep: SEO + image inventory (cheap, no measurement) ---
    const seoResults = [];
    const imageUrls = new Set();
    const sweep = await forEachPage(
      browser,
      allPages.map((p) => ({ ...p, url: `${baseUrl}/${p.id}.html` })),
      async (page, p) => {
        const seo = await extractSeo(page);
        seoResults.push({ id: p.id, ...seo });
        for (const src of await page.evaluate(COLLECT_IMAGES)) {
          try {
            imageUrls.add(new URL(src, page.url()).href);
          } catch {
            /* skip unparsable refs */
          }
        }
      },
      { viewport: { width: 1280, height: 1000 } }
    );
    for (const f of sweep.failures) report.warnings.push(`sweep ${f.page.id}: ${f.reason}`);

    const suffix = detectTitleSuffix(seoResults.map((r) => r.title));
    const homeSeo = seoResults.find((r) => r.id === homeId) ?? seoResults[0];

    await browser.close();
    server.close();

    return {
      report,
      pages: allPages,
      artifact,
      extracted,
      chromeHomeId: homeId,
      fontResult,
      seoResults: suffix ? seoResults.map((r) => ({ ...r, title: stripTitleSuffix(r.title, suffix) })) : seoResults,
      titleSuffix: suffix,
      homeSeo,
      imageUrls: [...imageUrls],
      buildNavData,
      buildFooterData,
      buildSiteInfo,
      collectChromeAssets,
      countNav,
    };
  } catch (err) {
    await browser.close().catch(() => {});
    server.close();
    throw err;
  } finally {
    fs.rmSync(mirrorDir, { recursive: true, force: true });
  }
}

export { emitTokens, emitSemanticOverrides, brandingPatch } from "../css/tokens/emit.mjs";
export { emitRamp };
