/**
 * Copy font-service/icon-font stylesheets and the binaries they reference.
 *
 * site-migrator's `mig tokens` records `branding.json.fontLinks` but never
 * copies the files behind them — `tools/port-fonts.mjs` existed only to patch
 * that gap after the fact. Here it's part of the extraction pass itself: a
 * font-service sheet is useless without its `@font-face` binaries, so the two
 * are copied together and verified before `fontLinks` is ever written.
 */

import fs from "node:fs";
import path from "node:path";
import { extractFontFaces, preferModernFormats } from "../css/fonts.mjs";

/**
 * @param {Array<{url, css, role}>} sheets  the sheets loadStylesheets read (font-service + icon-font roles)
 * @param {string} staticDir  local snapshot root the sheet/binary URLs resolve against
 * @param {import("../fs/write.mjs").Writer} writer
 * @param {string} publicDir  target-relative public dir (e.g. "public")
 */
export function copyFonts(sheets, { staticDir, writer, publicDir = "public" }) {
  const copied = [];
  const missing = [];
  const rewritten = []; // sheet urls that are now safe to reference (fontLinks)

  const localPathFor = (absUrl) => {
    let p;
    try {
      p = new URL(absUrl).pathname;
    } catch {
      return null;
    }
    return decodeURIComponent(p).replace(/^\//, "");
  };

  const copyOne = (rel) => {
    const from = path.join(staticDir, rel);
    if (!fs.existsSync(from) || !fs.statSync(from).isFile()) {
      missing.push(rel);
      return false;
    }
    writer.writeBinary(path.join(publicDir, rel), fs.readFileSync(from));
    copied.push(rel);
    return true;
  };

  for (const sheet of sheets) {
    if (sheet.role !== "font-service" && sheet.role !== "icon-font") continue;
    const sheetRel = localPathFor(sheet.url);
    if (!sheetRel) continue;

    const faces = extractFontFaces(sheet.css, sheet.url);
    let allOk = true;
    for (const face of faces) {
      const sources = preferModernFormats(face.sources);
      for (const src of sources) {
        const rel = localPathFor(src.url);
        if (!rel) {
          allOk = false;
          continue;
        }
        if (!copyOne(rel)) allOk = false;
      }
    }

    // The stylesheet itself (relative binary URLs inside it still resolve —
    // the snapshot mirrors WordPress's own path structure verbatim, so no
    // rewrite is needed as long as the referenced binaries were copied
    // alongside it at the same relative path).
    if (copyOne(sheetRel) && allOk) {
      rewritten.push(`/${sheetRel}`);
    }
  }

  return { copied, missing, fontLinks: rewritten };
}

/** The first family name in a CSS font stack, unquoted. */
function primaryFamily(stack) {
  const first = String(stack || "").split(",")[0].trim().replace(/^["']|["']$/g, "");
  return first && !/^(sans-serif|serif|monospace|cursive|fantasy|system-ui|inherit)$/i.test(first) ? first : null;
}

function declaresFamily(css, family) {
  const re = new RegExp(`@font-face[^}]*font-family:\\s*["']?${family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']?`, "i");
  return re.test(css);
}

/**
 * Make sure the families the page actually renders in are served by a
 * stylesheet the target ships.
 *
 * `fontLinks` is built from the stylesheets the *sampled* page linked, and page
 * builders enqueue font CSS per page — a heading font used site-wide can easily
 * be absent from the home page's links. The result is a migration whose
 * measured typography is right and whose rendered typography silently falls
 * back to the generic stack. The snapshot already holds the missing sheet, so
 * find it by the family it declares and bring it across too.
 */
export function ensureFamilySheets({ families, staticDir, writer, have = [], publicDir = "public" }) {
  const wanted = [...new Set(families.map(primaryFamily).filter(Boolean))];
  if (!wanted.length) return { fontLinks: [], copied: [], missing: [] };

  const readLocal = (rel) => {
    const abs = path.join(staticDir, rel.replace(/^\//, ""));
    return fs.existsSync(abs) && fs.statSync(abs).isFile() ? fs.readFileSync(abs, "utf8") : "";
  };
  const stillWanted = wanted.filter((family) => !have.some((link) => declaresFamily(readLocal(link), family)));
  if (!stillWanted.length) return { fontLinks: [], copied: [], missing: [] };

  const sheets = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".css")) sheets.push(full);
    }
  };
  for (const root of ["wp-content", "wp-includes"]) {
    const dir = path.join(staticDir, root);
    if (fs.existsSync(dir)) walk(dir);
  }

  const found = [];
  for (const family of stillWanted) {
    const hit = sheets.find((file) => declaresFamily(fs.readFileSync(file, "utf8"), family));
    if (hit) found.push({ family, url: `/${path.relative(staticDir, hit).split(path.sep).join("/")}` });
  }
  if (!found.length) return { fontLinks: [], copied: [], missing: stillWanted };

  // copyFonts resolves a sheet to disk through its URL *pathname*, so the URL
  // has to be site-relative the way a real stylesheet link is — a file:// URL
  // yields an absolute path and every lookup misses.
  const result = copyFonts(
    found.map((f) => ({ url: `https://source.invalid${f.url}`, css: readLocal(f.url), role: "font-service" })),
    { staticDir, writer, publicDir }
  );
  return { ...result, families: found.map((f) => f.family) };
}
