/**
 * Snapshot a live WordPress site into a flat static mirror, the shape
 * `crawlLocal` (mirror/crawl.mjs) expects: flat `<slug>.html` files with
 * root-relative asset references. Ported from site-migrator's
 * `tools/snapshot.mjs`, generalized — no hardcoded origin/host/sitemap-path,
 * and page discovery tries several strategies since a generic WordPress site
 * (unlike the one tools/snapshot.mjs was written against) may not run Yoast's
 * `/page-sitemap.xml`.
 *
 * Two acquisition modes:
 *
 *  - Render (default): each page is loaded in Chromium so its JavaScript runs,
 *    then its cleaned post-JS DOM is saved (see `src/snapshot/render.mjs`).
 *    This is what captures JS-injected design — carousels, review widgets,
 *    background videos, sliders, runtime CSS backgrounds — instead of leaving
 *    it to be rebuilt by hand. `render.mjs` strips every <script> before saving
 *    so the replay in the capture stages runs no builder JS (no double
 *    execution against an already-mutated DOM).
 *  - `--no-render`: plain `fetch`, saving pre-JS bytes — faster and fully
 *    deterministic, for sites whose design does not depend on JavaScript.
 *
 * Either way the output shape is identical (flat `<slug>.html`, root-relative
 * refs, assets under their real paths), so every downstream stage is unchanged.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { chromium } from "playwright";
import { renderPage } from "./render.mjs";

const UA = "Mozilla/5.0 (compatible; wp-migrator snapshot)";

// Anything HTML-ish is excluded from the asset set: crawlLocal walks the
// whole static tree for *.html and would pick a stray one up as a page.
const ASSET_EXT =
  /\.(css|js|mjs|json|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|mp4|webm|ogg|mp3|wav|pdf|docx?|xlsx?|zip)$/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);

async function fetchRetry(url, { retries = 3, asBuffer = false } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
      if (res.status === 404 || res.status === 410) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return asBuffer ? Buffer.from(await res.arrayBuffer()) : await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(500 * 2 ** attempt);
    }
  }
  throw new Error(`${url}: ${lastErr?.message ?? "failed"}`);
}

async function pool(items, size, delayMs, worker) {
  const queue = [...items];
  const results = [];
  const runners = Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      results.push(await worker(item));
      if (delayMs) await sleep(delayMs);
    }
  });
  await Promise.all(runners);
  return results;
}

/** Bare host, www-stripped, so `(?:www\.)?<bare>` matches both forms regardless
 *  of which one the caller's origin happened to use. */
function bareHost(originOrHost) {
  const host = originOrHost.includes("://") ? new URL(originOrHost).host : originOrHost;
  return host.replace(/^www\./i, "");
}

function hostRegex(originOrHost, flags, { anchored = false } = {}) {
  const prefix = anchored ? "^" : "";
  return new RegExp(
    `${prefix}https?://(?:www\\.)?${bareHost(originOrHost).replace(/\./g, "\\.")}`,
    flags
  );
}

function flatNameFor(pathname) {
  const clean = pathname.replace(/^\/+|\/+$/g, "");
  if (!clean) return "index.html";
  return `${clean.replace(/\//g, "-")}.html`;
}

function locsFromSitemapXml(xml) {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
  return { locs, isIndex: /<sitemapindex/i.test(xml) };
}

async function urlsFromSitemapRecursive(url, seen = new Set()) {
  if (seen.has(url)) return [];
  seen.add(url);
  const xml = await fetchRetry(url, { retries: 1 });
  if (!xml) return [];
  const { locs, isIndex } = locsFromSitemapXml(xml);
  if (!isIndex) return locs;
  const nested = await Promise.all(locs.map((l) => urlsFromSitemapRecursive(l, seen)));
  return nested.flat();
}

/**
 * Discover the page set. WordPress sites vary in what's enabled — core's own
 * `/wp-sitemap.xml` (5.5+), Yoast/RankMath's `/sitemap_index.xml` or
 * `/page-sitemap.xml`, or nothing at all. Try in order of how likely each is
 * to exist and to be *complete*; fall back to a same-origin link crawl from
 * the homepage, and to the REST API as a last resort for a headless-ish site.
 */
async function discoverPages(origin, { extraPaths = [] } = {}) {
  const candidates = ["/wp-sitemap.xml", "/sitemap_index.xml", "/sitemap.xml", "/page-sitemap.xml"];

  for (const candidate of candidates) {
    try {
      const urls = await urlsFromSitemapRecursive(origin + candidate);
      const paths = new Set(urls.map((u) => new URL(u).pathname));
      if (paths.size > 0) {
        for (const p of extraPaths) paths.add(p);
        return { paths: [...paths], strategy: candidate };
      }
    } catch {
      // try the next candidate
    }
  }

  // REST API: every public page/post, regardless of sitemap availability.
  try {
    const restPaths = new Set();
    for (const type of ["pages", "posts"]) {
      let page = 1;
      for (;;) {
        const res = await fetch(
          `${origin}/wp-json/wp/v2/${type}?per_page=100&page=${page}&_fields=link`,
          {
            headers: { "User-Agent": UA },
          }
        );
        if (!res.ok) break;
        const items = await res.json();
        if (!Array.isArray(items) || items.length === 0) break;
        for (const item of items) {
          if (item.link) restPaths.add(new URL(item.link).pathname);
        }
        if (items.length < 100) break;
        page++;
      }
    }
    if (restPaths.size > 0) {
      for (const p of extraPaths) restPaths.add(p);
      return { paths: [...restPaths], strategy: "wp-json REST API" };
    }
  } catch {
    // fall through to link crawl
  }

  // Same-origin breadth-first link crawl from the homepage.
  const found = new Set(["/"]);
  const queue = ["/"];
  const seen = new Set(queue);
  while (queue.length && found.size < 500) {
    const p = queue.shift();
    let html;
    try {
      html = await fetchRetry(new URL(p, origin).href, { retries: 1 });
    } catch {
      continue;
    }
    if (!html) continue;
    for (const m of html.matchAll(/<a\s[^>]*href=["']([^"'#]+)["']/gi)) {
      let next;
      try {
        next = new URL(m[1], origin + p);
      } catch {
        continue;
      }
      if (next.origin !== origin) continue;
      const np = next.pathname;
      if (seen.has(np)) continue;
      seen.add(np);
      found.add(np);
      queue.push(np);
    }
  }
  for (const p of extraPaths) found.add(p);
  return { paths: [...found], strategy: "link crawl" };
}

/** Rewrite one page's raw HTML: de-host, internal links -> flat filenames. */
function rewritePage(html, { origin, altHosts, pageByPath }) {
  let out = html;

  for (const host of altHosts) {
    out = out.replace(hostRegex(host, "gi"), origin);
  }

  out = out.replace(hostRegex(origin, "gi"), "");

  out = out.replace(/\bhref=(["'])([^"']*)\1/gi, (whole, q, value) => {
    const m = value.match(/^([^?#]*)([?#].*)?$/);
    const bare = m?.[1] ?? value;
    const suffix = m?.[2] ?? "";
    if (!bare.startsWith("/")) return whole;

    const withSlash = bare.endsWith("/") ? bare : `${bare}/`;
    const page = pageByPath.get(bare) ?? pageByPath.get(withSlash);
    if (!page) return whole;
    return `href=${q}${page.file}${suffix}${q}`;
  });

  // Elementor hides animated sections with this class (opacity: 0, cleared by
  // its own IntersectionObserver); harmless to strip on non-Elementor sites.
  out = out.replace(/\belementor-invisible\b/g, "");

  return out;
}

function assetRefsIn(html) {
  const refs = new Set();
  for (const m of html.matchAll(/\/wp-(?:content|includes)\/[^"'\s,)>\\]+/g)) {
    const ref = m[0].replace(/&amp;/g, "&");
    const clean = ref.split("?")[0].split("#")[0];
    if (!ASSET_EXT.test(clean)) continue;
    refs.add(clean);
  }
  return refs;
}

/**
 * @param {object} opts
 * @param {string} opts.origin  e.g. "https://example.com" (no trailing slash)
 * @param {string} opts.out  directory to write the flat mirror into
 * @param {string[]} [opts.altHosts]  staging/legacy hosts to normalize to origin
 * @param {string[]} [opts.extraPaths]  paths to include beyond sitemap/crawl discovery
 * @param {boolean} [opts.refresh]  re-fetch pages already on disk
 * @param {number} [opts.limit]  cap page count (smoke testing)
 * @param {number} [opts.concurrency]
 * @param {number} [opts.delayMs]  politeness delay between requests per worker
 * @param {boolean} [opts.render]  render each page with JS (default true)
 * @param {number} [opts.renderViewport]  render width in px (default 1440)
 * @param {number} [opts.renderSettleMs]  settle after JS waits (default 1500)
 * @param {number} [opts.renderConcurrency]  page concurrency when rendering (default 2)
 * @param {(msg:string)=>void} [opts.log]
 */
export async function runSnapshot(opts) {
  const {
    origin,
    out,
    altHosts = [],
    extraPaths = [],
    refresh = false,
    limit = 0,
    concurrency = 3,
    delayMs = 250,
    retries = 3,
    render = true,
    renderViewport = 1440,
    renderSettleMs = 1500,
    renderConcurrency = 2,
    log = () => {},
  } = opts;

  fs.mkdirSync(out, { recursive: true });
  const manifestPath = path.join(out, ".snapshot-manifest.json");
  const manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    : { pages: {}, assets: {} };

  log(`Discovering pages from ${origin} …`);
  const discovery = await discoverPages(origin, { extraPaths });
  log(`  strategy: ${discovery.strategy} — ${discovery.paths.length} page(s)`);

  let pages = discovery.paths
    .sort()
    .map((p) => ({ path: p, url: origin + p, file: flatNameFor(p) }));
  if (limit) pages = pages.slice(0, limit);

  const pageByPath = new Map();
  for (const p of pages) {
    pageByPath.set(p.path, p);
    if (!p.path.endsWith("/")) pageByPath.set(`${p.path}/`, p);
  }

  const assetRefs = new Set();
  const report = {
    generatedAt: new Date().toISOString(),
    origin,
    strategy: discovery.strategy,
    pages: [],
  };
  let fetched = 0;
  let skipped = 0;
  const pageFailures = [];

  // Rendering launches one Chromium for the whole page pool; fetch mode needs
  // no browser. Chromium pages are heavier than fetch, so the pool runs at a
  // lower concurrency when rendering.
  const browser = render ? await chromium.launch() : null;
  if (render) log(`  rendering pages with JavaScript (viewport ${renderViewport}px)`);
  const pageConcurrency = render ? renderConcurrency : concurrency;

  try {
    await pool(pages, pageConcurrency, delayMs, async (page) => {
      const dest = path.join(out, page.file);
      let html;
      if (!refresh && fs.existsSync(dest)) {
        html = fs.readFileSync(dest, "utf8");
        skipped++;
      } else {
        let raw;
        if (render) {
          const r = await renderPage(browser, page.url, {
            viewport: { width: renderViewport, height: 1000 },
            settleMs: renderSettleMs,
          });
          if (!r.ok) {
            pageFailures.push({ path: page.path, reason: r.reason ?? "render failed" });
            return;
          }
          raw = r.html;
        } else {
          try {
            raw = await fetchRetry(page.url, { retries });
          } catch (err) {
            pageFailures.push({ path: page.path, reason: err.message });
            return;
          }
          if (raw === null) {
            pageFailures.push({ path: page.path, reason: "404" });
            return;
          }
        }
        html = rewritePage(raw, { origin, altHosts, pageByPath });
        fs.writeFileSync(dest, html, "utf8");
        manifest.pages[page.path] = {
          file: page.file,
          sha: sha(html),
          fetchedAt: new Date().toISOString(),
        };
        fetched++;
        if (fetched % 10 === 0) log(`  … ${fetched} ${render ? "rendered" : "fetched"}`);
      }
      for (const ref of assetRefsIn(html)) assetRefs.add(ref);
      report.pages.push({
        path: page.path,
        file: page.file,
        id: page.file.replace(/\.html$/, ""),
        bytes: Buffer.byteLength(html),
      });
    });
  } finally {
    if (browser) await browser.close();
  }

  log(
    `Pages: ${fetched} ${render ? "rendered" : "fetched"}, ${skipped} already on disk, ${pageFailures.length} failed`
  );

  // ---- assets, recursively (CSS may reference more assets) ----------------
  const queue = [...assetRefs];
  const seen = new Set(queue);
  const failures = [];
  const repaired = [];
  let downloaded = 0;
  let reused = 0;

  const hostRes = [
    hostRegex(origin, "i", { anchored: true }),
    ...altHosts.map((h) => hostRegex(h, "i", { anchored: true })),
  ];

  const localise = (raw, dir) => {
    let ref = raw.trim();
    for (const re of hostRes) if (re.test(ref)) ref = ref.replace(re, "");
    if (/^(data:|https?:|\/\/|#)/i.test(ref)) return null;
    if (!ref) return null;
    return path.posix.normalize(ref.startsWith("/") ? ref : path.posix.join(dir, ref));
  };

  const enqueue = (clean) => {
    if (ASSET_EXT.test(clean) && !seen.has(clean)) {
      seen.add(clean);
      queue.push(clean);
    }
  };

  const processCss = (cssPath, css) => {
    const dir = path.posix.dirname(cssPath);
    let outCss = css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (whole, q, ref) => {
      const resolved = localise(ref, dir);
      if (!resolved) return whole;
      const clean = resolved.split("?")[0].split("#")[0];
      enqueue(clean);
      return `url(${q}${clean}${q})`;
    });
    outCss = outCss.replace(/@import\s+(['"])([^'"]+)\1/gi, (whole, q, ref) => {
      const resolved = localise(ref, dir);
      if (!resolved) return whole;
      const clean = resolved.split("?")[0].split("#")[0];
      enqueue(clean);
      return `@import ${q}${clean}${q}`;
    });
    return outCss;
  };

  while (queue.length) {
    const batch = queue.splice(0, queue.length);
    await pool(batch, concurrency * 2, 0, async (ref) => {
      const dest = path.join(out, ref.replace(/^\//, ""));
      if (fs.existsSync(dest) && !refresh) {
        reused++;
        if (/\.css$/i.test(ref)) processCss(ref, fs.readFileSync(dest, "utf8"));
        return;
      }
      try {
        let buf = await fetchRetry(origin + ref, { retries, asBuffer: true });

        // Elementor's "Local Google Fonts" sheets on a multisite install
        // reference their woff2 files under a `/uploads/sites/<id>/` prefix
        // that can 404 on the live origin even though the site itself
        // resolves it (a stale blog-id baked into the CSS at generation
        // time). The files exist one level up. Fetch from the working path
        // but save at the path the stylesheet asks for, so the reference
        // resolves locally without having to rewrite the CSS.
        if (buf === null && /\/uploads\/sites\/\d+\//.test(ref)) {
          const alt = ref.replace(/\/uploads\/sites\/\d+\//, "/uploads/");
          buf = await fetchRetry(origin + alt, { retries, asBuffer: true });
          if (buf !== null) repaired.push(ref);
        }

        if (buf === null) {
          failures.push({ ref, reason: "404" });
          return;
        }
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (/\.css$/i.test(ref)) {
          fs.writeFileSync(dest, processCss(ref, buf.toString("utf8")), "utf8");
        } else {
          fs.writeFileSync(dest, buf);
        }
        manifest.assets[ref] = { sha: sha(buf), bytes: buf.length };
        downloaded++;
        if (downloaded % 50 === 0) log(`  … ${downloaded} assets`);
      } catch (err) {
        failures.push({ ref, reason: err.message });
      }
    });
  }

  log(
    `Assets: ${downloaded} downloaded, ${reused} already on disk, ` +
      `${repaired.length} repaired from stale multisite paths, ${failures.length} failed`
  );

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  report.assetFailures = failures;
  report.assetsRepaired = repaired;
  report.pageFailures = pageFailures;
  fs.writeFileSync(
    path.join(out, ".snapshot-report.json"),
    JSON.stringify(report, null, 2),
    "utf8"
  );

  return report;
}
