import fs from "node:fs";
import path from "node:path";
import valueParser from "postcss-value-parser";

/**
 * Asset collection and `url()` rewriting.
 *
 * CSS-referenced assets are rehosted at the *same paths they had on the source
 * site*. That choice keeps rewriting trivially correct: a synthesized component
 * built from raw source markup carries `src="assets/images/x.png"` attributes
 * unchanged, and background `url()`s in ported CSS resolve without a lookup
 * table. Content images destined for the framework's image pipeline are copied
 * separately.
 */

const IGNORE = /^(data:|about:|#|blob:)/i;

/** Every `url()` in a declaration value, with its resolved absolute location. */
export function urlsInValue(value, baseUrl) {
  const found = [];
  const parsed = valueParser(value);

  parsed.walk((node) => {
    if (node.type !== "function" || node.value !== "url") return;
    const arg = node.nodes[0];
    if (!arg) return;
    const raw = arg.value.trim();
    if (!raw || IGNORE.test(raw)) return;
    found.push({ raw, resolved: resolveAgainst(raw, baseUrl) });
  });

  return found;
}

/**
 * Resolve a reference against the stylesheet that contains it — not the page.
 * A sheet at `/css/site.css` referring to `../img/x.png` means `/img/x.png`,
 * which is a different file from what page-relative resolution would give.
 */
export function resolveAgainst(ref, baseUrl) {
  if (/^https?:\/\//i.test(ref)) return ref;
  if (!baseUrl) return ref.replace(/^\//, "");

  if (/^https?:\/\//i.test(baseUrl)) {
    try {
      return new URL(ref, baseUrl).href;
    } catch {
      return ref;
    }
  }

  // Local mirror: resolve as a posix path relative to the sheet's directory.
  const dir = path.posix.dirname(baseUrl.replace(/^\//, ""));
  if (ref.startsWith("/")) return ref.replace(/^\//, "");
  return path.posix.normalize(path.posix.join(dir, ref));
}

/** Strip a cache-busting query so the stored filename stays clean. */
export function stripQuery(ref) {
  return ref.split("?")[0].split("#")[0];
}

/**
 * Where a source asset lands in the target repo. Source paths are mirrored
 * verbatim, so `assets/images/x.png` becomes `public/assets/images/x.png` and
 * is served at `/assets/images/x.png`.
 */
export function targetPathFor(resolved, { publicDir = "public" } = {}) {
  let rel = stripQuery(resolved);

  if (/^https?:\/\//i.test(rel)) {
    // A remote asset keeps its path but is namespaced by host so two CDNs
    // cannot collide on a shared filename.
    const u = new URL(rel);
    rel = path.posix.join("external", u.host, u.pathname.replace(/^\//, ""));
  }

  rel = rel.replace(/^\/+/, "");
  return { file: path.join(publicDir, rel), url: `/${rel.split(path.sep).join("/")}` };
}

/**
 * Collect every asset referenced by a set of rules and copy it into the target.
 *
 * @param {object[]} rules   parsed rules, each with `decls` and `sheetUrl`
 * @param {object} opts      { mirrorDir, writer, publicDir }
 * @returns {Map<string,string>} resolved source location -> served URL
 */
export function collectAssets(rules, { mirrorDir, writer, publicDir = "public" } = {}) {
  const map = new Map();
  const missing = [];

  for (const rule of rules) {
    for (const decl of rule.decls) {
      for (const { resolved } of urlsInValue(decl.value, rule.sheetUrl)) {
        if (map.has(resolved)) continue;

        const { file, url } = targetPathFor(resolved, { publicDir });

        if (/^https?:\/\//i.test(resolved)) {
          // Remote assets are fetched by the caller; record the mapping only.
          map.set(resolved, url);
          continue;
        }

        const source = path.resolve(mirrorDir, stripQuery(resolved));
        if (!fs.existsSync(source)) {
          missing.push(resolved);
          continue;
        }

        if (writer) writer.writeBinary(file, fs.readFileSync(source));
        map.set(resolved, url);
      }
    }
  }

  return { map, missing };
}

/**
 * Rewrite `url()` references in a declaration value to their served locations.
 * References with no mapping are left untouched rather than guessed at.
 */
export function rewriteUrls(value, baseUrl, map) {
  if (!/url\(/i.test(value)) return value;

  const parsed = valueParser(value);
  parsed.walk((node) => {
    if (node.type !== "function" || node.value !== "url") return;
    const arg = node.nodes[0];
    if (!arg) return;

    const raw = arg.value.trim();
    if (!raw || IGNORE.test(raw)) return;

    const replacement = map.get(resolveAgainst(raw, baseUrl));
    if (!replacement) return;

    arg.value = replacement;
    if (arg.type === "word") {
      arg.type = "string";
      arg.quote = '"';
    }
  });

  return parsed.toString();
}

/** Fetch remote assets recorded during collection. */
export async function fetchRemoteAssets(map, { writer, publicDir = "public" } = {}) {
  const failures = [];

  for (const [resolved] of map) {
    if (!/^https?:\/\//i.test(resolved)) continue;
    const { file } = targetPathFor(resolved, { publicDir });

    try {
      const res = await fetch(resolved);
      if (!res.ok) {
        failures.push({ url: resolved, reason: `HTTP ${res.status}` });
        continue;
      }
      if (writer) writer.writeBinary(file, Buffer.from(await res.arrayBuffer()));
    } catch (e) {
      failures.push({ url: resolved, reason: e.message });
    }
  }

  return failures;
}
