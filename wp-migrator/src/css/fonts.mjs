import postcss from "postcss";
import safeParser from "postcss-safe-parser";
import valueParser from "postcss-value-parser";

/**
 * Font handling.
 *
 * Two things routinely get lost in a migration and both are cheap to keep:
 *
 * 1. Hosted font services. A site's headings are set in a Typekit or Google
 *    face; if the stylesheet link isn't carried over, typography silently
 *    falls back to a system font and every heading is subtly wrong.
 *
 * 2. Icon fonts. A `.icon-phone:before { content: "\e80d" }` sheet defines the
 *    site's entire icon set in one file. Rebuilding those icons as individual
 *    SVGs by hand is a large job that the source already answers — the font and
 *    its glyph map just need porting.
 */

/** Extract `@font-face` blocks with their resolved source URLs. */
export function extractFontFaces(css, baseUrl) {
  const root = postcss.parse(css, { parser: safeParser });
  const faces = [];

  root.walkAtRules(/^font-face$/i, (at) => {
    const face = { family: null, weight: null, style: null, sources: [], css: at.toString() };

    at.walkDecls((decl) => {
      const prop = decl.prop.toLowerCase();
      if (prop === "font-family") face.family = decl.value.replace(/["']/g, "").trim();
      else if (prop === "font-weight") face.weight = decl.value.trim();
      else if (prop === "font-style") face.style = decl.value.trim();
      else if (prop === "src") {
        const parsed = valueParser(decl.value);
        parsed.walk((node) => {
          if (node.type !== "function" || node.value !== "url") return;
          const raw = node.nodes[0]?.value?.trim();
          if (!raw) return;
          face.sources.push({ raw, url: resolveUrl(raw, baseUrl) });
        });
      }
    });

    if (face.family) faces.push(face);
  });

  return faces;
}

function resolveUrl(ref, baseUrl) {
  if (/^(data:|https?:)/i.test(ref)) return ref;
  try {
    return new URL(ref, baseUrl).href;
  } catch {
    return ref;
  }
}

/**
 * Build the glyph map from an icon-font stylesheet.
 *
 * Returns `{ "icon-phone": "\\e80d", ... }` plus the CSS class prefix, so the
 * target's icon component can be regenerated instead of hand-authored.
 */
export function extractIconGlyphs(css) {
  const root = postcss.parse(css, { parser: safeParser });
  const glyphs = {};

  root.walkRules((rule) => {
    const contentDecl = rule.nodes?.find(
      (n) => n.type === "decl" && n.prop.toLowerCase() === "content"
    );
    if (!contentDecl) return;

    const codepoint = contentDecl.value.match(/^["'](\\[0-9a-f]{2,6})["']$/i);
    if (!codepoint) return;

    for (const selector of rule.selectors) {
      // `.icon-phone:before` -> `icon-phone`
      const m = selector.trim().match(/^\.([\w-]+)::?(?:before|after)$/i);
      if (!m) continue;
      glyphs[m[1]] = codepoint[1];
    }
  });

  return glyphs;
}

/** The font-family an icon set renders with, so the target can declare it. */
export function iconFontFamily(css) {
  const root = postcss.parse(css, { parser: safeParser });
  let family = null;

  root.walkRules((rule) => {
    if (family) return;
    if (!/\[class\^?=|\.icon-/.test(rule.selector)) return;
    rule.walkDecls(/^font-family$/i, (decl) => {
      family = decl.value.replace(/["']/g, "").split(",")[0].trim();
    });
  });

  if (family) return family;

  const faces = extractFontFaces(css, "https://example.com/");
  return faces[0]?.family ?? null;
}

/**
 * Rewrite `src: url(...)` to point at the rehosted files.
 * @param {Map<string,string>} urlMap original URL -> path in the target repo
 */
export function rewriteFontFaceUrls(faceCss, urlMap, baseUrl) {
  const root = postcss.parse(faceCss, { parser: safeParser });

  root.walkDecls(/^src$/i, (decl) => {
    const parsed = valueParser(decl.value);
    parsed.walk((node) => {
      if (node.type !== "function" || node.value !== "url") return;
      const target = node.nodes[0];
      if (!target) return;
      const resolved = resolveUrl(target.value.trim(), baseUrl);
      const replacement = urlMap.get(resolved);
      if (replacement) {
        target.value = replacement;
        target.quote = '"';
        target.type = "string";
      }
    });
    decl.value = parsed.toString();
  });

  return root.toString();
}

/**
 * Drop the legacy formats. `eot`/`ttf`/`svg` exist for browsers the target
 * template does not support, and each one is a needless download.
 */
export function preferModernFormats(sources) {
  const byFormat = (ext) => sources.filter((s) => new RegExp(`\\.${ext}\\b`, "i").test(s.raw));
  const woff2 = byFormat("woff2");
  if (woff2.length) return woff2;
  const woff = byFormat("woff");
  if (woff.length) return woff;
  return sources.slice(0, 1);
}
