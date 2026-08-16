import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";
import safeParser from "postcss-safe-parser";
import { detectRootFontSize, normalizeRoot } from "./units.mjs";

/**
 * Build a stylesheet graph from the source site.
 *
 * Order is preserved throughout: it *is* the cascade, and a port that replays
 * rules out of order produces colours and spacing that are individually right
 * and collectively wrong. `postcss-safe-parser` is used rather than the strict
 * parser because real sites ship minified single-line CSS and IE hacks like
 * `@media all and (-ms-high-contrast:none)` that would otherwise throw.
 */

const FONT_SERVICE_HOSTS = [
  "fonts.googleapis.com",
  "use.typekit.net",
  "fonts.bunny.net",
  "cloud.typography.com",
  "fast.fonts.net",
];

/** Classify a stylesheet so fonts and icon fonts are handled, not inlined. */
export function classifySheet(url, css) {
  let host = "";
  try {
    host = new URL(url).host;
  } catch {
    /* relative path */
  }

  if (FONT_SERVICE_HOSTS.some((h) => host.endsWith(h))) return "font-service";

  const fontFaces = (css.match(/@font-face/gi) || []).length;
  if (fontFaces > 0) {
    const totalRules = (css.match(/\{/g) || []).length;
    if (fontFaces / Math.max(totalRules, 1) > 0.8) return "font-service";

    // An icon font pairs @font-face with a wall of `.icon-x:before{content:"\eNNN"}`.
    const glyphRules = (css.match(/content\s*:\s*["']\\[0-9a-f]{3,5}["']/gi) || []).length;
    if (glyphRules >= 20) return "icon-font";
  }

  return "stylesheet";
}

async function readSheet(ref, { mirrorDir }) {
  const url = typeof ref === "string" ? ref : ref.url;

  if (/^https?:\/\//i.test(url)) {
    try {
      const res = await fetch(url);
      if (!res.ok) return { url, css: "", error: `HTTP ${res.status}` };
      return { url, css: await res.text() };
    } catch (e) {
      return { url, css: "", error: e.message };
    }
  }

  const file = path.resolve(mirrorDir, url.replace(/^\//, ""));
  if (!fs.existsSync(file)) return { url, css: "", error: "not found" };
  return { url, css: fs.readFileSync(file, "utf8") };
}

/**
 * Load every source stylesheet in declared order, normalise units, and index
 * the rules.
 */
export async function loadStylesheets(refs, { mirrorDir, rootFontSizePx = "auto" } = {}) {
  const sheets = [];

  for (const ref of refs) {
    const declaredRole = typeof ref === "string" ? undefined : ref.role;
    const loaded = await readSheet(ref, { mirrorDir });
    const role = declaredRole ?? classifySheet(loaded.url, loaded.css);
    sheets.push({ ...loaded, role });
  }

  const styleSheets = sheets.filter((s) => s.role === "stylesheet" && s.css);

  const rootPx =
    rootFontSizePx === "auto" ? (detectRootFontSize(styleSheets) ?? 16) : rootFontSizePx;

  const rules = [];
  const stats = { converted: 0, dropped: 0 };

  styleSheets.forEach((sheet, sheetIndex) => {
    let root;
    try {
      root = postcss.parse(sheet.css, { parser: safeParser, from: sheet.url });
    } catch (e) {
      sheet.error = `parse failed: ${e.message}`;
      return;
    }

    const result = normalizeRoot(root, rootPx);
    stats.converted += result.converted;
    stats.dropped += result.dropped;

    let ruleIndex = 0;
    root.walkRules((rule) => {
      // Reconstruct the at-rule conditions wrapping this rule.
      const atRuleChain = [];
      for (let p = rule.parent; p && p.type !== "root"; p = p.parent) {
        if (p.type === "atrule") atRuleChain.unshift(`@${p.name} ${p.params}`.trim());
      }

      // @keyframes steps ("0%", "from") are not selectors — skip them here;
      // they travel with their @keyframes block instead.
      if (atRuleChain.some((a) => /^@(-\w+-)?keyframes/i.test(a))) return;

      rules.push({
        sheetIndex,
        sheetUrl: sheet.url,
        ruleIndex: ruleIndex++,
        selectors: rule.selectors,
        atRuleChain,
        decls: rule.nodes
          .filter((n) => n.type === "decl")
          .map((d) => ({ prop: d.prop, value: d.value, important: d.important === true })),
        node: rule,
      });
    });

    sheet.root = root;
  });

  return {
    sheets,
    rules,
    rootPx,
    stats,
    fontServices: sheets.filter((s) => s.role === "font-service").map((s) => s.url),
    iconFonts: sheets.filter((s) => s.role === "icon-font"),
  };
}

/** Collect `@keyframes` blocks by name so animations survive the port. */
export function collectKeyframes(sheets) {
  const byName = new Map();
  for (const sheet of sheets) {
    if (!sheet.root) continue;
    sheet.root.walkAtRules(/^(-\w+-)?keyframes$/i, (at) => {
      if (!byName.has(at.params)) byName.set(at.params, at.toString());
    });
  }
  return byName;
}

/**
 * A rule is part of a CSS reset when it targets many bare tags and only sets
 * layout-neutralising properties. The target template already ships a reset
 * layer, so porting another one on top just fights it.
 */
export function isResetRule(rule) {
  const bareTags = rule.selectors.filter((s) => /^[a-z][a-z0-9]*$/i.test(s.trim()));
  if (bareTags.length < 5) return false;

  const resetProps = new Set(["margin", "padding", "border", "box-sizing", "font-size", "font"]);
  return rule.decls.every((d) => resetProps.has(d.prop.toLowerCase()));
}

/** Legacy vendor fallbacks autoprefixer will regenerate if they're needed. */
export function isLegacyVendorDecl(prop, value) {
  const p = prop.toLowerCase();
  if (/^-ms-/.test(p)) return true;
  if (/^(display)$/.test(p) && /^-(webkit|ms)-(box|flexbox)$/i.test(value.trim())) return true;
  if (/^-webkit-box-(orient|direction|pack|align)$/.test(p)) return true;
  return false;
}
