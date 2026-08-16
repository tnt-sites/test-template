#!/usr/bin/env node
/**
 * Snapshot a live WordPress/Elementor site into a flat static mirror that
 * `mig mirror` can crawl as `source.base: file:./static`.
 *
 * site-migrator ingests static HTML. It does not care what generated that HTML,
 * so a WordPress source only needs its *rendered* output on disk in the shape
 * `crawlLocal` expects. That shape has two hard requirements:
 *
 *   1. Pages are FLAT `<slug>.html` files. `pageIdFor` (src/mirror/crawl.mjs)
 *      turns `/our-office/index.html` into the id `our-office-index`, and the
 *      Astro route then strips the trailing `index` and emits the slug
 *      `our-office-`. Flat `our-office.html` gives the id `our-office` and the
 *      route `/our-office/`, byte-identical to the live URL.
 *
 *   2. Asset references are ROOT-RELATIVE, never absolute. `collectContentAssets`
 *      (src/content/index.mjs) early-returns on anything matching
 *      `^(https?:|data:|//)`, so a page still carrying WordPress's absolute
 *      `https://host/wp-content/...` image URLs would copy zero images into the
 *      target. Rewritten to `/wp-content/...` they resolve against the
 *      instrumented mirror and port correctly.
 *
 * Plain `fetch`, deliberately — not Playwright. `runMirror` saves the raw bytes
 * and uid-stamps them with parse5; every later stage runs its own Playwright
 * pass over the result. Saving post-JS `outerHTML` here would make Elementor's
 * frontend script run twice against an already-mutated DOM and would consume
 * the `data-settings` blobs `mig behaviors` reads.
 *
 * Usage:
 *   node tools/snapshot.mjs
 *   node tools/snapshot.mjs --refresh          # re-fetch pages already on disk
 *   node tools/snapshot.mjs --limit 5          # smoke test
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const DEFAULTS = {
  origin: "https://artisandentalmadison.com",
  // Older posts and guids still point at the staging host the site was built
  // on. Normalised to the live origin before anything else, so a single set of
  // rewrite rules covers both.
  altHosts: ["scott-andersen.eblocks.io"],
  sitemap: "/page-sitemap.xml",
  // /blog/ is listed in post-sitemap.xml, not page-sitemap.xml, but it is a
  // page for our purposes: `mig content` turns it into src/content/pages/blog.md,
  // which src/pages/blog/[...page].astro reads for the blog index hero.
  extraPaths: ["/blog/"],
  out: path.join(ROOT, "static"),
  concurrency: 3,
  delayMs: 250,
  retries: 3,
};

const UA = "Mozilla/5.0 (compatible; site-migrator snapshot; artisandentalmadison.com migration)";

// Assets we mirror. Anything HTML-ish is excluded: crawlLocal walks the whole
// static tree for *.html and would pick a stray one up as a page.
const ASSET_EXT =
  /\.(css|js|mjs|json|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|mp4|webm|ogg|mp3|wav|pdf|docx?|xlsx?|zip)$/i;

function parseArgs(argv) {
  const args = { ...DEFAULTS, refresh: false, limit: 0 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--refresh") args.refresh = true;
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--concurrency") args.concurrency = Number(argv[++i]);
    else if (a === "--origin") args.origin = argv[++i];
    else if (a === "--out") args.out = path.resolve(argv[++i]);
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fetch with retry/backoff. Returns null on a definitive 404. */
async function fetchRetry(url, { retries, asBuffer = false } = { retries: 3 }) {
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

/** Run tasks through a fixed-size pool, with a politeness delay per task. */
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

/**
 * The flat filename a page path is saved as. `/` becomes index.html; every
 * other path collapses its slashes so `pageIdFor` yields a clean slug.
 */
function flatNameFor(pathname) {
  const clean = pathname.replace(/^\/+|\/+$/g, "");
  if (!clean) return "index.html";
  return `${clean.replace(/\//g, "-")}.html`;
}

async function discoverPages(args) {
  const xml = await fetchRetry(args.origin + args.sitemap, { retries: args.retries });
  if (!xml) throw new Error(`Sitemap not found: ${args.origin + args.sitemap}`);

  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
  const paths = new Set(locs.map((u) => new URL(u).pathname));
  for (const p of args.extraPaths) paths.add(p);

  return [...paths]
    .sort()
    .map((p) => ({ path: p, url: args.origin + p, file: flatNameFor(p) }));
}

/**
 * Rewrite one page's raw HTML.
 *
 * Regex over the raw text rather than a parse5 round-trip: re-serialising
 * perturbs whitespace, and `runMirror` compares raw bytes between runs to
 * detect source drift (uid stability depends on the HTML not moving).
 */
function rewritePage(html, { origin, altHosts, pageByPath }) {
  let out = html;

  // 1. Staging host -> live origin, so one set of rules covers both.
  for (const host of altHosts) {
    out = out.replace(new RegExp(`https?://(?:www\\.)?${host.replace(/\./g, "\\.")}`, "gi"), origin);
  }

  // 2. Strip the origin everywhere, leaving root-relative paths. This single
  //    pass covers href/src/poster/data-src, every URL inside srcset (each one
  //    is absolute, so no comma-splitting is needed), inline style url(), and
  //    URLs embedded in Elementor's inline <script> settings.
  const originRe = new RegExp(
    `https?://(?:www\\.)?${new URL(origin).host.replace(/\./g, "\\.")}`,
    "gi"
  );
  out = out.replace(originRe, "");

  // 3. Internal page links -> the flat filename we saved that page as. Scoped
  //    to href attributes so asset paths keep their root-relative form.
  //    Elementor emits single-quoted attributes, hence the backreference.
  out = out.replace(/\bhref=(["'])([^"']*)\1/gi, (whole, q, value) => {
    const m = value.match(/^([^?#]*)([?#].*)?$/);
    const bare = m?.[1] ?? value;
    const suffix = m?.[2] ?? "";
    if (!bare.startsWith("/")) return whole;

    const withSlash = bare.endsWith("/") ? bare : `${bare}/`;
    const page = pageByPath.get(bare) ?? pageByPath.get(withSlash);
    if (!page) return whole; // /blog/<slug>/ and asset paths fall through unchanged
    return `href=${q}${page.file}${suffix}${q}`;
  });

  // 4. Elementor hides animated sections with `elementor-invisible`
  //    (opacity: 0, cleared by its own IntersectionObserver). `revealAnimated`
  //    in src/browser/load.mjs matches animate/fade/data-aos and does not catch
  //    this, so every scan and QA measurement would read a blank section.
  out = out.replace(/\belementor-invisible\b/g, "");

  return out;
}

/** Every mirrored asset path referenced by a rewritten page. */
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

/** Stylesheet hrefs in document order — the basis for the cascade ordering. */
function stylesheetsIn(html) {
  const sheets = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/\brel=(["'])?[^"'>]*stylesheet/i.test(tag)) continue;
    const href = tag.match(/\bhref=(["'])([^"']*)\1/i)?.[2];
    if (href && href.startsWith("/")) sheets.push(href.split("?")[0]);
  }
  return sheets;
}

function elementorRootsIn(html) {
  return [...new Set([...html.matchAll(/data-elementor-type=(["'])([^"']+)\1/g)].map((m) => m[2]))];
}

const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);

async function main() {
  const args = parseArgs(process.argv);
  fs.mkdirSync(args.out, { recursive: true });

  const manifestPath = path.join(args.out, ".snapshot-manifest.json");
  const manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    : { pages: {}, assets: {} };

  console.log(`Discovering pages from ${args.origin}${args.sitemap} …`);
  let pages = await discoverPages(args);
  if (args.limit) pages = pages.slice(0, args.limit);
  console.log(`  ${pages.length} unique pages`);

  const pageByPath = new Map();
  for (const p of pages) {
    pageByPath.set(p.path, p);
    if (!p.path.endsWith("/")) pageByPath.set(`${p.path}/`, p);
  }

  // ---- Pages -------------------------------------------------------------
  const assetRefs = new Set();
  const sheetOrder = new Map(); // href -> first-seen document position
  const report = { generatedAt: new Date().toISOString(), origin: args.origin, pages: [] };
  let fetched = 0;
  let skipped = 0;

  await pool(pages, args.concurrency, args.delayMs, async (page) => {
    const dest = path.join(args.out, page.file);

    let html;
    if (!args.refresh && fs.existsSync(dest)) {
      html = fs.readFileSync(dest, "utf8");
      skipped++;
    } else {
      const raw = await fetchRetry(page.url, { retries: args.retries });
      if (raw === null) {
        console.warn(`  ! 404 ${page.path}`);
        return;
      }
      html = rewritePage(raw, { ...args, pageByPath });
      fs.writeFileSync(dest, html, "utf8");
      manifest.pages[page.path] = { file: page.file, sha: sha(html), fetchedAt: new Date().toISOString() };
      fetched++;
      if (fetched % 10 === 0) console.log(`  … ${fetched} fetched`);
    }

    for (const ref of assetRefsIn(html)) assetRefs.add(ref);
    stylesheetsIn(html).forEach((href, i) => {
      if (!sheetOrder.has(href)) sheetOrder.set(href, i);
    });
    report.pages.push({
      path: page.path,
      file: page.file,
      id: page.file.replace(/\.html$/, ""),
      elementorRoots: elementorRootsIn(html),
      bytes: Buffer.byteLength(html),
    });
  });

  console.log(`Pages: ${fetched} fetched, ${skipped} already on disk`);

  // ---- Assets ------------------------------------------------------------
  // CSS is processed as it lands: each sheet's own url()/@import references are
  // resolved against the sheet, queued, and rewritten to root-relative form.
  // This is what brings the self-hosted Roboto / Roboto Slab / Open Sans /
  // Poppins woff2 files across — without them every font measurement in
  // `mig qa` compares against a fallback face.
  const queue = [...assetRefs];
  const seen = new Set(queue);
  const failures = [];
  const repaired = [];
  let downloaded = 0;
  let reused = 0;

  // Absolute references inside a stylesheet must be de-hosted before anything
  // else. Elementor's google-fonts sheets point at their woff2 files with the
  // full origin (on a /sites/157/ multisite path, so relative resolution would
  // not have found them either). Skipping absolute refs here silently drops
  // every brand typeface and leaves `mig qa` comparing fallback faces.
  const hostRes = [
    new RegExp(`^https?://(?:www\\.)?${new URL(args.origin).host.replace(/\./g, "\\.")}`, "i"),
    ...args.altHosts.map((h) => new RegExp(`^https?://(?:www\\.)?${h.replace(/\./g, "\\.")}`, "i")),
  ];

  const localise = (raw, dir) => {
    let ref = raw.trim();
    for (const re of hostRes) if (re.test(ref)) ref = ref.replace(re, "");
    if (/^(data:|https?:|\/\/|#)/i.test(ref)) return null; // genuinely third-party
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

    let out = css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (whole, q, ref) => {
      const resolved = localise(ref, dir);
      if (!resolved) return whole;
      const clean = resolved.split("?")[0].split("#")[0];
      enqueue(clean);
      return `url(${q}${clean}${q})`;
    });

    // `@import "sheet.css"` — the bare-string form the url() rule above misses.
    out = out.replace(/@import\s+(['"])([^'"]+)\1/gi, (whole, q, ref) => {
      const resolved = localise(ref, dir);
      if (!resolved) return whole;
      const clean = resolved.split("?")[0].split("#")[0];
      enqueue(clean);
      return `@import ${q}${clean}${q}`;
    });

    return out;
  };

  while (queue.length) {
    const batch = queue.splice(0, queue.length);
    await pool(batch, args.concurrency * 2, 0, async (ref) => {
      const dest = path.join(args.out, ref.replace(/^\//, ""));
      if (fs.existsSync(dest) && !args.refresh) {
        reused++;
        // Still recurse: a cached sheet may reference assets we have not queued.
        if (/\.css$/i.test(ref)) processCss(ref, fs.readFileSync(dest, "utf8"));
        return;
      }
      try {
        let buf = await fetchRetry(args.origin + ref, { retries: args.retries, asBuffer: true });

        // Elementor's google-fonts sheets reference their woff2 files under a
        // stale multisite prefix (`/uploads/sites/157/`) that 404s on the live
        // origin — the site itself is falling back for its declared faces. The
        // files do exist one level up. Fetch from the working path but save at
        // the path the stylesheet asks for, so the reference resolves locally
        // without rewriting the CSS.
        if (buf === null && /\/uploads\/sites\/\d+\//.test(ref)) {
          const alt = ref.replace(/\/uploads\/sites\/\d+\//, "/uploads/");
          buf = await fetchRetry(args.origin + alt, { retries: args.retries, asBuffer: true });
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
        if (downloaded % 50 === 0) console.log(`  … ${downloaded} assets`);
      } catch (err) {
        failures.push({ ref, reason: err.message });
      }
    });
  }

  console.log(
    `Assets: ${downloaded} downloaded, ${reused} already on disk, ` +
      `${repaired.length} repaired from stale multisite paths, ${failures.length} failed`
  );

  // ---- Reports -----------------------------------------------------------
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  report.assetFailures = failures;
  report.assetsRepaired = repaired;
  report.templateCounts = report.pages.reduce((acc, p) => {
    const key = p.elementorRoots.filter((r) => r !== "header" && r !== "footer").join("+") || "(none)";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  fs.writeFileSync(path.join(ROOT, "snapshot-report.json"), JSON.stringify(report, null, 2), "utf8");

  // `source.stylesheets` is one global cascade-ordered list. Order sheets by
  // where they first appeared in any page's document, so the globals land in
  // their real cascade order and the ~85 per-page post-<id>.css files append
  // afterwards (their order relative to each other is immaterial — each is
  // scoped by an Elementor page-id class and none can shadow another).
  const ordered = [...sheetOrder.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .map(([href]) => href.replace(/^\//, ""));

  const role = (href) =>
    /font-awesome|eicons|elementor-icons/i.test(href)
      ? "icon-font"
      : /google-fonts|fonts\.googleapis/i.test(href)
        ? "font-service"
        : null;

  const yaml = [
    "# Generated by tools/snapshot.mjs — paste into migration.config.yml as",
    "# `source.stylesheets`. Order is the cascade.",
    "stylesheets:",
    ...ordered.map((href) => {
      const r = role(href);
      return r ? `  - url: ${href}\n    role: ${r}` : `  - ${href}`;
    }),
  ].join("\n");
  fs.writeFileSync(path.join(ROOT, "stylesheets.generated.yml"), `${yaml}\n`, "utf8");

  console.log(`\nWrote:`);
  console.log(`  ${path.relative(process.cwd(), args.out)}/            ${report.pages.length} pages + assets`);
  console.log(`  snapshot-report.json          template census, asset failures`);
  console.log(`  stylesheets.generated.yml     ${ordered.length} sheets in cascade order`);
  console.log(`\nTemplates:`, report.templateCounts);
  if (failures.length) {
    console.log(`\n${failures.length} asset failures (first 10):`);
    for (const f of failures.slice(0, 10)) console.log(`  ${f.reason}  ${f.ref}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
