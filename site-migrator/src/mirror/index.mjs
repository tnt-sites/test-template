import fs from "node:fs";
import path from "node:path";
import { crawlLocal, crawlRemote, routeFor } from "./crawl.mjs";
import { instrumentHtml } from "./instrument.mjs";
import { resolveSourceBase } from "../config/load.mjs";

/**
 * Build the instrumented mirror: the normalised, uid-stamped copy of the source
 * site that every later stage reads from.
 */
export async function runMirror(ctx, { refresh = false } = {}) {
  const { config, paths } = ctx;
  const source = resolveSourceBase(config, paths.configDir);

  const mirrorDir = path.join(paths.artifacts, "mirror");
  const instrumentedDir = path.join(paths.artifacts, "instrumented");
  fs.mkdirSync(mirrorDir, { recursive: true });
  fs.mkdirSync(instrumentedDir, { recursive: true });

  const pages =
    source.kind === "local"
      ? crawlLocal(source.dir, {
          exclude: config.source.exclude,
          maxPages: config.source.maxPages,
        })
      : await crawlRemote(source.url, {
          entry: config.source.entry,
          exclude: config.source.exclude,
          maxPages: config.source.maxPages,
        });

  if (pages.length === 0) {
    throw new Error(
      `No pages discovered from ${config.source.base}. Check \`source.base\` and \`source.exclude\`.`
    );
  }

  const manifest = { generatedAt: new Date().toISOString(), source: config.source.base, pages: [] };
  const drift = [];

  for (const page of pages) {
    const raw =
      source.kind === "local"
        ? fs.readFileSync(page.file, "utf8")
        : await (await fetch(page.url)).text();

    const rawPath = path.join(mirrorDir, `${page.id}.html`);
    const previousRaw = fs.existsSync(rawPath) ? fs.readFileSync(rawPath, "utf8") : null;

    // uid stability depends on the raw HTML not changing underneath us. Report
    // drift rather than silently renumbering every section on the page.
    if (previousRaw !== null && previousRaw !== raw && !refresh) {
      drift.push(page.id);
    }

    fs.writeFileSync(rawPath, raw, "utf8");

    const { html, count } = instrumentHtml(raw, page.id);
    fs.writeFileSync(path.join(instrumentedDir, `${page.id}.html`), html, "utf8");

    manifest.pages.push({
      id: page.id,
      path: page.path,
      route: routeFor(page.path, config.urls),
      elements: count,
    });
  }

  // Non-HTML assets need to be reachable at their original paths so the mirror
  // renders with real CSS/JS/images.
  if (source.kind === "local") {
    copyNonHtml(source.dir, instrumentedDir);
  }

  fs.writeFileSync(
    path.join(paths.artifacts, "pages.json"),
    JSON.stringify(manifest, null, 2),
    "utf8"
  );

  return { pages: manifest.pages, drift, instrumentedDir, mirrorDir };
}

function copyNonHtml(srcDir, destDir) {
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const from = path.join(srcDir, entry.name);
    const to = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      copyNonHtml(from, to);
    } else if (!/\.html?$/i.test(entry.name)) {
      fs.copyFileSync(from, to);
    }
  }
}

/**
 * The instrumented tree is keyed by page id, but the source used real paths
 * (`/about-us.html`). Write flat aliases so links between pages still resolve
 * when the mirror is served.
 */
export function writePathAliases(instrumentedDir, pages) {
  for (const page of pages) {
    const target = path.join(instrumentedDir, `${page.id}.html`);
    const alias = path.join(instrumentedDir, page.path.replace(/^\//, ""));
    if (alias === target || !fs.existsSync(target)) continue;
    fs.mkdirSync(path.dirname(alias), { recursive: true });
    fs.copyFileSync(target, alias);
  }
}
