#!/usr/bin/env node
/**
 * Port the source's self-hosted webfonts into the target's public/ tree.
 *
 * `mig tokens` records every `role: font-service` stylesheet in
 * src/data/branding.json as `fontLinks`, and BaseLayout.astro renders those
 * verbatim as <link href>. But the toolkit never copies the files themselves —
 * it assumes a font service (Google Fonts, Typekit) reachable at an absolute
 * URL. This source self-hosts, so the recorded paths point at nothing in the
 * built site and every brand face silently falls back.
 *
 * This copies each font stylesheet and the woff2/woff files it references from
 * the snapshot into public/ at the same paths, then rewrites `fontLinks` to be
 * root-relative so they resolve.
 *
 * Idempotent. Run after `mig tokens`, before `npm run build`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATIC = path.join(ROOT, "static");
const REPO = path.resolve(ROOT, "..");
const PUBLIC = path.join(REPO, "public");
const BRANDING = path.join(REPO, "src/data/branding.json");

const branding = JSON.parse(fs.readFileSync(BRANDING, "utf8"));
const links = Array.isArray(branding.fontLinks) ? branding.fontLinks : [];

let sheets = 0;
let files = 0;
const missing = [];

const copy = (rel) => {
  const from = path.join(STATIC, rel);
  const to = path.join(PUBLIC, rel);
  if (!fs.existsSync(from)) {
    missing.push(rel);
    return false;
  }
  if (!fs.existsSync(to)) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    files++;
  }
  return true;
};

const ported = [];
for (const link of links) {
  // Only local paths; a real font-service URL is left alone.
  if (/^https?:\/\//i.test(link)) {
    ported.push(link);
    continue;
  }
  const rel = link.replace(/^\//, "");
  if (!copy(rel)) {
    ported.push(link);
    continue;
  }
  sheets++;

  // Pull across every face the sheet references. These carry the stale
  // /uploads/sites/157/ prefix that tools/snapshot.mjs already repaired on
  // disk, so resolving against the sheet's own directory finds them.
  const css = fs.readFileSync(path.join(STATIC, rel), "utf8");
  const dir = path.posix.dirname(`/${rel}`);
  for (const m of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) {
    const raw = m[1].trim();
    if (/^(data:|https?:|\/\/)/i.test(raw)) continue;
    const resolved = path.posix.normalize(
      raw.startsWith("/") ? raw : path.posix.join(dir, raw)
    );
    copy(resolved.replace(/^\//, "").split("?")[0]);
  }

  ported.push(`/${rel}`);
}

branding.fontLinks = ported;
fs.writeFileSync(BRANDING, `${JSON.stringify(branding, null, 2)}\n`, "utf8");

console.log(`Ported ${sheets} font stylesheet(s), ${files} file(s) into public/`);
console.log(`branding.fontLinks rewritten root-relative:`);
for (const p of ported) console.log(`  ${p}`);
if (missing.length) {
  console.log(`\n${missing.length} referenced file(s) not in the snapshot:`);
  for (const m of missing.slice(0, 10)) console.log(`  ${m}`);
}
