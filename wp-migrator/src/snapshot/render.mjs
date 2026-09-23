/**
 * Render a live page with JavaScript and return its cleaned post-JS HTML.
 *
 * The plain-`fetch` snapshot saves pre-JS bytes, so anything a script injects
 * — carousels, review widgets, background videos, before/after sliders, video
 * accordions, and CSS background-images resolved by the theme at runtime — is
 * simply absent, and every one of those had to be rebuilt by hand. This path
 * lets the page's own JavaScript run, waits for it to settle, then bakes the
 * resulting DOM into the mirror.
 *
 * Two problems the naive "save outerHTML" approach has, and how this solves them:
 *
 *  1. Double execution — replaying a post-JS DOM through the capture stages
 *     would run the builder's frontend script a second time against an
 *     already-mutated DOM. We strip every <script> before serializing, so the
 *     replay is inert and measures exactly what we captured.
 *
 *  2. Frozen layout — a DOM rendered at one width bakes the JS-set inline
 *     geometry (swiper slide widths/transforms, masonry absolute offsets) that
 *     will not re-flow when the capture stages resize to their other
 *     breakpoints. We remove that inline geometry (and the loop-clone slides)
 *     while keeping the content, so CSS media queries govern again and the
 *     migrator's own carousel routing still fires on the surviving slider root.
 */

import { gotoStable, scrollThrough, resolveLazyImages } from "../browser/load.mjs";

// Selectors that signal a JS-mounted widget has appeared. Each is waited for
// independently and tolerantly — a miss just times out. Covers the builder
// video/embed iframes, the common carousel engines, and Trustindex reviews.
const DEFAULT_WAIT_SELECTORS = [
  "iframe",
  ".swiper-initialized",
  ".swiper-slide",
  ".slick-slider",
  ".splide__track",
  ".owl-carousel",
  '[class*="trustindex"]',
  ".ti-widget-container",
];

/**
 * @param {import('playwright').Browser} browser
 * @param {string} url  the LIVE page url
 * @param {object} [opts]
 * @param {{width:number,height:number}} [opts.viewport]
 * @param {number} [opts.settleMs]         final settle after all waits
 * @param {number} [opts.networkidleCapMs] cap on the networkidle race
 * @param {string[]} [opts.waitSelectors]
 * @param {number} [opts.selectorTimeout]  per-selector wait budget
 * @param {number} [opts.timeout]          navigation timeout
 * @returns {Promise<{ok:boolean, html?:string, reason?:string, errors?:any[]}>}
 */
export async function renderPage(browser, url, opts = {}) {
  const {
    viewport = { width: 1440, height: 1000 },
    settleMs = 1500,
    networkidleCapMs = 8000,
    waitSelectors = DEFAULT_WAIT_SELECTORS,
    selectorTimeout = 3000,
    timeout = 30000,
  } = opts;

  const page = await browser.newPage({ viewport });
  try {
    // Reuse the tool's own robust load (domcontentloaded + load + fonts.ready +
    // lazy resolution + scrollThrough). reveal/freezeMotion stay OFF: those
    // inject <style> overrides we do not want serialized into the saved DOM —
    // dev-page re-applies reveal on replay itself.
    const state = await gotoStable(page, url, {
      timeout,
      settleMs: 0,
      primeLazyLoad: true,
      reveal: false,
      freezeMotion: false,
    });
    if (!state.ok) return { ok: false, reason: state.reason, errors: state.errors };

    // Third-party widgets (reviews, chat) can keep the network busy forever, so
    // never *wait* on networkidle — race it against a hard cap.
    await Promise.race([
      page.waitForLoadState("networkidle", { timeout: networkidleCapMs }).catch(() => {}),
      page.waitForTimeout(networkidleCapMs),
    ]);

    // Best-effort per-widget waits; each tolerated so a missing widget can't
    // stall the whole render.
    for (const sel of waitSelectors) {
      await page.waitForSelector(sel, { timeout: selectorTimeout, state: "attached" }).catch(() => {});
    }

    // A second light pass catches images a carousel/review widget injected late.
    await scrollThrough(page);
    await resolveLazyImages(page);
    await page.waitForTimeout(settleMs);

    const html = await page.evaluate(cleanAndSerialize);
    return { ok: true, html, errors: state.errors };
  } catch (err) {
    return { ok: false, reason: err?.message ?? "render failed" };
  } finally {
    await page.close();
  }
}

/**
 * Runs in the page context. Strips scripts (kills replay double-execution) and
 * JS-set slider/masonry geometry (keeps content, lets CSS re-flow), drops
 * consent overlays, and returns the serialized document.
 *
 * Defined as a named function passed to page.evaluate so it is self-contained.
 */
function cleanAndSerialize() {
  // 1. Neutralize scripts — the replay must run zero builder JS.
  for (const s of Array.from(document.querySelectorAll("script"))) s.remove();

  // 2. Slider/masonry geometry that a single-viewport render would freeze.
  for (const c of document.querySelectorAll(".swiper-slide-duplicate")) c.remove();
  const tracks = document.querySelectorAll(
    ".swiper-wrapper, .swiper-slide, .slick-track, .slick-slide, .splide__list, .owl-stage, .owl-item"
  );
  for (const el of tracks) {
    el.style.removeProperty("transform");
    el.style.removeProperty("width");
    el.style.removeProperty("transition");
    el.style.removeProperty("transition-duration");
  }
  for (const el of document.querySelectorAll('[class*="masonry"] > *, .brick, .grid-item')) {
    if (el.style && el.style.position === "absolute") {
      el.style.removeProperty("position");
      el.style.removeProperty("top");
      el.style.removeProperty("left");
    }
  }

  // 3. Consent/cookie overlays the render happened to capture.
  for (const el of document.querySelectorAll(
    '#onetrust-consent-sdk, .cookie-notice, [id*="cookie-law"], [class*="cookie-consent"], [class*="cookie-banner"]'
  )) {
    el.remove();
  }

  return "<!DOCTYPE html>\n" + document.documentElement.outerHTML;
}
