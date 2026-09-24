import { defineMiddleware } from "astro:middleware";

/**
 * Every link that leaves the site opens in a new tab.
 *
 * The online-booking link (s.hsone.io) alone is carried by a dozen components
 * across ~40 pages, each with its own link props and its own idea of `target`.
 * Enforcing it per component misses the next page someone builds, so it is
 * enforced once here, on the rendered HTML: any `<a>` whose href is absolute
 * http(s) on a foreign host, and which does not already choose a `target`,
 * gets `target="_blank"` and a `rel` that keeps the new tab from reaching back.
 * Runs at build time for prerendered pages, so the output is plain static HTML.
 */
const OWN_HOSTS = new Set(["chapelhilldentalarts.com", "www.chapelhilldentalarts.com"]);

const HREF = /\shref\s*=\s*(["'])(https?:\/\/[^"']+)\1/i;

const isForeign = (href: string, currentHost: string) => {
  try {
    const host = new URL(href).host;
    return host !== currentHost && !OWN_HOSTS.has(host);
  } catch {
    return false;
  }
};

export const openExternalLinksInNewTab = (html: string, currentHost: string) =>
  html.replace(/<a\b[^>]*>/gi, (tag) => {
    const href = tag.match(HREF)?.[2];
    if (!href || !isForeign(href, currentHost) || /\starget\s*=/i.test(tag)) return tag;
    const rel = /\srel\s*=/i.test(tag) ? "" : ' rel="noopener noreferrer"';
    return tag.replace(/^<a\b/i, `<a target="_blank"${rel}`);
  });

export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();
  if (!response.headers.get("content-type")?.includes("text/html")) return response;
  const html = await response.text();
  return new Response(openExternalLinksInNewTab(html, context.url.host), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
});
