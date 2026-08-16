import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

/**
 * HTML to Markdown for migrated body copy.
 *
 * Embeds are preserved as raw HTML rather than discarded. Dropping an
 * `<iframe>` and leaving a "manual review" note behind loses the one piece of
 * information nobody can reconstruct later — the URL. MDX accepts raw HTML, so
 * keeping the element intact costs nothing and keeps the page complete.
 */

export function createTurndown({ preserveEmbeds = true } = {}) {
  const service = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
  });

  service.use(gfm);

  if (preserveEmbeds) {
    service.addRule("preserveEmbeds", {
      filter: ["iframe", "video", "audio", "embed", "object"],
      replacement: (_content, node) => `\n\n${node.outerHTML}\n\n`,
    });
  }

  // Scripts and styles are never content.
  service.addRule("dropScripts", {
    filter: ["script", "style", "noscript"],
    replacement: () => "",
  });

  return service;
}

const service = createTurndown();

export function htmlToMarkdown(html) {
  if (!html || !html.trim()) return "";
  return service
    .turndown(html)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Plain text with collapsed whitespace, for headings and short fields. */
export function htmlToText(html) {
  if (!html) return "";
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;|&rdquo;|&ldquo;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Inline markdown for headings — the template's heading inputs accept limited
 * inline markup, so emphasis and links survive but block structure does not.
 */
export function htmlToInline(html) {
  if (!html) return "";
  const md = htmlToMarkdown(html);
  return md.replace(/\n+/g, " ").replace(/^#+\s*/, "").trim();
}
