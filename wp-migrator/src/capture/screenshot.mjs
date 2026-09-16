/**
 * Multi-viewport screenshots — the visual ground truth.
 *
 * The same module serves both sides of the comparison: the rendered WordPress
 * page and the rendered Astro page. Using one code path is the point — a
 * difference in how the two sides were captured would show up as a "visual
 * difference" that isn't one.
 */

import fs from "node:fs";
import path from "node:path";
import { gotoStable } from "../browser/load.mjs";
import { expandDisclosures } from "../browser/disclose.mjs";

/** Widths the brief requires. Desktop first so the widest layout settles first. */
export const VIEWPORTS = [1440, 768, 390];

/**
 * Neutralize things that make a capture non-deterministic or occlude content:
 * full-viewport fixed overlays (cookie walls, promo modals) and sticky bars
 * that would otherwise be burned into a full-page screenshot at every scroll
 * position.
 */
async function suppressOverlays(page) {
  await page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      if (cs.position !== "fixed" && cs.position !== "sticky") continue;
      const r = el.getBoundingClientRect();
      const covers = r.width * r.height > vw * vh * 0.35;
      // `className` is an SVGAnimatedString on SVG and undefined-ish on custom
      // elements, so read the attribute and include the tag name — the Astro
      // dev toolbar is a bare `<astro-dev-toolbar>` with neither id nor class,
      // and it is small enough to pass the coverage test. It has to go: a dev
      // server is the fastest thing to screenshot against, and a toolbar burned
      // into every capture is a difference that is not a difference.
      const named = /modal|popup|dialog|overlay|lightbox|cookie|consent|dev-toolbar/i.test(
        `${el.tagName} ${el.id} ${el.getAttribute("class") || ""}`
      );
      if (covers || named) el.style.setProperty("display", "none", "important");
    }
  });
}

/**
 * Capture one page at every viewport.
 *
 * @returns {Promise<Array<{width:number,file:string,pageHeight:number}>>}
 */
export async function capturePageShots(
  page,
  url,
  outDir,
  { prefix = "page", viewports = VIEWPORTS, disclose = true } = {}
) {
  fs.mkdirSync(outDir, { recursive: true });
  const shots = [];

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    const state = await gotoStable(page, url, {
      primeLazyLoad: true,
      reveal: true,
      freezeMotion: true,
    });
    if (!state.ok) throw new Error(`capture failed at ${width}px for ${url}: ${state.reason}`);
    // Open accordions on BOTH sides before shooting. The source mirror is a
    // pre-JS snapshot whose panels are closed, while the build renders them in
    // whatever state its own markup says — so without this the two sides differ
    // by every collapsed panel's height. On this site that was an 8,000px
    // difference on one page: a 44% "pixel mismatch" that was entirely an
    // artefact of how the two sides were captured, which is the one thing a
    // visual comparison must never invent.
    if (disclose) await expandDisclosures(page).catch(() => {});
    await suppressOverlays(page);
    // Re-prime after suppression: hiding an overlay can reflow content and
    // reveal images that had not yet been scrolled into view.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(350);

    const file = path.join(outDir, `${prefix}@${width}.png`);
    await page.screenshot({ path: file, fullPage: true });
    const pageHeight = await page.evaluate(() => document.body.scrollHeight);
    shots.push({ width, file, pageHeight });
  }

  return shots;
}

/**
 * Capture one element (a section) at every viewport, clipped to its own box.
 * Section-level shots are what make a diff actionable — a whole-page diff on a
 * 14,000px page tells you nothing about which section drifted.
 */
export async function captureElementShots(
  page,
  url,
  selector,
  outDir,
  { prefix, viewports = VIEWPORTS } = {}
) {
  fs.mkdirSync(outDir, { recursive: true });
  const shots = [];

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    const state = await gotoStable(page, url, {
      primeLazyLoad: true,
      reveal: true,
      freezeMotion: true,
    });
    if (!state.ok) continue;
    await suppressOverlays(page);

    const handle = await page.$(selector);
    if (!handle) continue;
    await handle.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(250);

    const file = path.join(outDir, `${prefix}@${width}.png`);
    try {
      await handle.screenshot({ path: file });
    } catch {
      continue; // zero-size or detached at this width
    }
    const box = await handle.boundingBox();
    shots.push({ width, file, box });
  }

  return shots;
}
