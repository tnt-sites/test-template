/**
 * Carry the source page's `<head>` metadata across.
 *
 * Descriptions, canonicals and structured data are invisible in a visual review
 * but are the difference between a migration that holds its search rankings and
 * one that quietly discards them on every page.
 */
export async function extractSeo(page) {
  return page.evaluate(() => {
    const meta = (selector, attr = "content") =>
      document.querySelector(selector)?.getAttribute(attr)?.trim() || null;

    const jsonLd = [...document.querySelectorAll('script[type="application/ld+json"]')]
      .map((s) => {
        try {
          return JSON.parse(s.textContent);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    return {
      title: document.title?.trim() || null,
      description: meta('meta[name="description"]'),
      keywords: meta('meta[name="keywords"]'),
      canonical: meta('link[rel="canonical"]', "href"),
      og: {
        title: meta('meta[property="og:title"]'),
        description: meta('meta[property="og:description"]'),
        image: meta('meta[property="og:image"]'),
      },
      structuredData: jsonLd.length ? jsonLd : null,
    };
  });
}

/**
 * Strip a site-wide suffix from page titles.
 *
 * Source titles are usually written for search results ("Veneers Springfield MA
 * | Practice Name"). The target renders its own suffix, so keeping the source's
 * verbatim duplicates it on every page.
 */
export function stripTitleSuffix(title, suffix) {
  if (!title || !suffix) return title;
  const trimmed = title.replace(new RegExp(`\\s*[|\\-–—]\\s*${escapeRegExp(suffix)}\\s*$`, "i"), "");
  return trimmed.trim() || title;
}

/** The longest common trailing segment across titles, if there is one. */
export function detectTitleSuffix(titles) {
  const segmented = titles
    .filter(Boolean)
    .map((t) => t.split(/\s*[|\-–—]\s*/).map((s) => s.trim()))
    .filter((parts) => parts.length > 1);

  if (segmented.length < 3) return null;

  const last = segmented.map((parts) => parts[parts.length - 1]);
  const counts = {};
  for (const s of last) counts[s] = (counts[s] ?? 0) + 1;

  const [best, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] ?? [];
  return count >= segmented.length * 0.6 ? best : null;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
