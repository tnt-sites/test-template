/**
 * Auto-discover a page's stylesheets from the rendered DOM, in cascade order.
 * Builder-agnostic by design: no hand-maintained stylesheet list (contrast
 * with `migration.config.yml`'s `source.stylesheets`) — whatever the browser
 * actually loaded and applied is what gets read back.
 */

function DISCOVER() {
  return [...document.querySelectorAll('link[rel="stylesheet"][href]')].map((el) => el.getAttribute("href"));
}

/**
 * @returns {Promise<string[]>} absolute stylesheet URLs, in document order.
 *   `loadStylesheets` has no inline-`<style>` support, so those are skipped —
 *   in practice the cascade a WP theme/builder ships lives in linked sheets.
 */
export async function discoverStylesheets(page) {
  const hrefs = await page.evaluate(DISCOVER);
  const baseUrl = page.url();
  return hrefs.map((href) => new URL(href, baseUrl).href);
}
