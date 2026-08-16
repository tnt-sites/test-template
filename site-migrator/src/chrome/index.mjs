import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { serve } from "../mirror/serve.mjs";
import { gotoStable } from "../browser/load.mjs";
import { extractChrome } from "./extract.mjs";
import { buildUrlMap, detectSourceHost, rewriteUrl } from "../content/links.mjs";
import { buildOffice } from "./office.mjs";
import { measureChromeStyles, assetsIn } from "./styles.mjs";

/**
 * Fill the template's header, footer and site-info data from the source.
 *
 * Chrome is identical on every page, so it is read once from a representative
 * page rather than per page.
 */
export async function runChrome(ctx, { from = "index" } = {}) {
  const { config, paths } = ctx;

  const mirrorDir = path.join(paths.artifacts, "instrumented");
  if (!fs.existsSync(mirrorDir)) throw new Error("No mirror found. Run `mig mirror` first.");

  const { pages } = JSON.parse(fs.readFileSync(path.join(paths.artifacts, "pages.json"), "utf8"));
  const source = pages.find((p) => p.id === from) ?? pages[0];
  if (!source) throw new Error("No pages in the mirror to read chrome from.");

  const { server, url: baseUrl } = await serve(mirrorDir, 0);
  const browser = await chromium.launch();

  let extracted;
  let styles = null;
  try {
    const page = await browser.newPage({
      viewport: { width: config.segmentation.viewport, height: 1000 },
    });
    const state = await gotoStable(page, `${baseUrl}/${source.id}.html`, {
      primeLazyLoad: true,
      reveal: true,
    });
    if (!state.ok) throw new Error(`Could not load ${source.id}: ${state.reason}`);

    extracted = await extractChrome(page, {
      chrome: config.segmentation.chrome,
      buttonClassPattern: config.props.buttonClassPattern,
    });
    styles = await measureChromeStyles(page, {
      chrome: config.segmentation.chrome,
      roleSelectors: config.segmentation.chromeRoleSelectors,
    });
    await page.close();
  } finally {
    await browser.close();
    server.close();
  }

  // Route every captured link through the same map used for content, so the
  // nav cannot point at legacy URLs the rest of the site no longer uses.
  const rawDir = path.join(paths.artifacts, "mirror");
  const sourceHost = config.source.base.startsWith("http")
    ? config.source.base.replace(/\/$/, "")
    : detectSourceHost(readMirror(rawDir), pages);
  const urlMap = buildUrlMap(pages, { sourceHost });

  const relink = (node) => {
    if (Array.isArray(node)) return node.forEach(relink);
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === "string" && /^(path|link|href)$/.test(key)) {
        node[key] = rewriteUrl(value, urlMap).url;
      } else relink(value);
    }
  };
  relink(extracted);

  return { extracted, styles, sourcePage: source.id };
}

function readMirror(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.html?$/i.test(e.name))
    .map((e) => fs.readFileSync(path.join(dir, e.name), "utf8"));
}

/** Merge extracted values into an existing data file, preserving its shape. */
export function buildNavData(extracted, current = {}) {
  const next = { ...current };
  if (extracted.header?.logo?.source) {
    next.logoSource = extracted.header.logo.source;
    next.logoAlt = extracted.header.logo.alt || next.logoAlt || "";
  }
  if (extracted.header?.nav?.length) next.navData = extracted.header.nav;
  return next;
}

export function buildFooterData(extracted, current = {}) {
  const next = { ...current };
  if (extracted.footer?.logo?.source) {
    next.logoSource = extracted.footer.logo.source;
    next.logoAlt = extracted.footer.logo.alt || next.logoAlt || "";
  }

  if (extracted.footer?.links?.length) {
    // Legal links usually sit apart from the main footer menu, so keep the
    // template's split rather than collapsing everything into one list.
    const legalPattern = /privacy|terms|sitemap|accessibility|disclaimer|cookie/i;
    const links = [];
    const legal = [];
    const seen = new Set();

    for (const link of extracted.footer.links) {
      const key = `${link.name}|${link.path}`;
      if (seen.has(key) || !link.name) continue;
      seen.add(key);
      (legalPattern.test(link.name) ? legal : links).push(link);
    }

    if (links.length) next.links = links;
    if (legal.length) next.legalLinks = legal;
  }

  return next;
}

export function buildSiteInfo(extracted, current = {}) {
  const next = { ...current };
  if (extracted.siteName) next.siteName = extracted.siteName;
  if (extracted.footer?.socials?.length) next.socials = extracted.footer.socials;

  // Contact details belong on the office record the template renders from, not
  // as loose top-level keys nothing reads.
  const office = buildOffice(extracted, current.offices?.[0]);
  if (Object.keys(office).length) {
    next.offices = [office, ...(current.offices ?? []).slice(1)];
  }

  return next;
}

/**
 * Copy the chrome's own images (logos) into the target and rewrite their paths.
 *
 * Source paths are mirrored verbatim, matching how content images are handled,
 * so a logo referenced as `assets/images/logo.svg` is served from the same
 * place and nothing has to be reconciled later.
 */
export function collectChromeAssets(extracted, { mirrorDir, writer, publicDir = "public" }) {
  const copied = [];
  const missing = [];

  const move = (holder, key) => {
    const src = holder?.[key];
    if (!src || /^(https?:|data:|\/\/)/i.test(src)) return;

    const clean = src.split("?")[0].split("#")[0].replace(/^\//, "");
    if (!clean || clean.endsWith("/")) return;

    const from = path.resolve(mirrorDir, clean);
    if (!fs.existsSync(from) || !fs.statSync(from).isFile()) {
      missing.push(src);
      return;
    }

    writer.writeBinary(path.join(publicDir, clean), fs.readFileSync(from));
    holder[key] = `/${clean}`;
    copied.push(clean);
  };

  move(extracted.header?.logo, "source");
  move(extracted.footer?.logo, "source");

  return { copied, missing };
}

/**
 * Copy the images the chrome's *styling* references.
 *
 * A footer's background graphic is invisible to markup extraction — it exists
 * only in a CSS rule — so it has to be collected from the measured styles or it
 * silently disappears from the migration.
 */
export function collectStyleAssets(styles, { mirrorDir, writer, publicDir = "public" }) {
  const map = new Map();
  const missing = [];

  for (const ref of assetsIn(styles ?? {})) {
    const from = path.resolve(mirrorDir, ref);
    if (!fs.existsSync(from) || !fs.statSync(from).isFile()) {
      missing.push(ref);
      continue;
    }
    writer.writeBinary(path.join(publicDir, ref), fs.readFileSync(from));
    map.set(ref, `/${ref}`);
  }

  return { map, missing };
}

/** Count the items in a nav tree, for reporting. */
export function countNav(items) {
  return (items ?? []).reduce((n, item) => n + 1 + countNav(item.children), 0);
}
