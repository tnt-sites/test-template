/**
 * Opens every off-site link in a new tab — the booking site, articles, and
 * anything editors add later in CloudCannon — without each component or
 * content file having to remember to. Runs over the rendered HTML, so it also
 * covers markdown and `set:html` content. Links that already set a `target`
 * are left alone.
 */
import { defineMiddleware } from "astro:middleware";

const INTERNAL_HOSTS = new Set(["toothbar.com", "www.toothbar.com"]);

const isExternal = (href: string) => {
  if (!/^https?:\/\//i.test(href)) return false;
  try {
    return !INTERNAL_HOSTS.has(new URL(href).hostname.toLowerCase());
  } catch {
    return false;
  }
};

const openExternalLinksInNewTab = (html: string) =>
  html.replace(/<a\b[^>]*>/gi, (tag) => {
    if (/\starget\s*=/i.test(tag)) return tag;
    const href = tag.match(/\shref\s*=\s*(["'])(.*?)\1/i)?.[2];

    if (!href || !isExternal(href.replace(/&amp;/g, "&"))) return tag;

    const rel = /\srel\s*=/i.test(tag) ? "" : ' rel="noopener noreferrer"';

    return tag.replace(/\s*>$/, ` target="_blank"${rel}>`);
  });

export const onRequest = defineMiddleware(async (_context, next) => {
  const response = await next();

  if (!response.headers.get("content-type")?.includes("text/html")) return response;

  const html = await response.text();

  return new Response(openExternalLinksInNewTab(html), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
});
