import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { gotoStable } from "../browser/load.mjs";

/**
 * Visual comparison between the source site and the migrated one.
 *
 * Full-page pixel diffs are close to useless for triage: one section that is
 * thirty pixels taller pushes everything below it out of alignment and reports
 * as a total mismatch. Comparing elements individually keeps a difference
 * attributed to the thing that actually differs.
 */

/** Capture one element, or the full page when no selector is given. */
export async function captureElement(page, url, selector, options = {}) {
  const state = await gotoStable(page, url, {
    primeLazyLoad: true,
    reveal: true,
    freezeMotion: true,
    ...options,
  });
  if (!state.ok) return { ok: false, reason: state.reason };

  if (!selector) {
    return { ok: true, buffer: await page.screenshot({ fullPage: true }), errors: state.errors };
  }

  const locator = page.locator(selector).first();
  if ((await locator.count()) === 0) return { ok: false, reason: `no match for ${selector}` };

  try {
    const box = await locator.boundingBox();
    const buffer = await locator.screenshot();
    return { ok: true, buffer, box, errors: state.errors };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/**
 * Compare two captures.
 *
 * Images are padded to a common size rather than cropped, so a height or width
 * difference shows up as a difference instead of being quietly discarded.
 */
export function comparePngs(aBuffer, bBuffer, { threshold = 0.1 } = {}) {
  const a = PNG.sync.read(aBuffer);
  const b = PNG.sync.read(bBuffer);

  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);

  const pad = (png) => {
    if (png.width === width && png.height === height) return png;
    const out = new PNG({ width, height });
    // Transparent padding, so added area counts as differing.
    out.data.fill(0);
    PNG.bitblt(png, out, 0, 0, png.width, png.height, 0, 0);
    return out;
  };

  const padded = { a: pad(a), b: pad(b) };
  const diff = new PNG({ width, height });

  const differing = pixelmatch(padded.a.data, padded.b.data, diff.data, width, height, {
    threshold,
  });

  return {
    differing,
    total: width * height,
    percent: (differing / (width * height)) * 100,
    diff: PNG.sync.write(diff),
    dimensions: { a: { w: a.width, h: a.height }, b: { w: b.width, h: b.height } },
  };
}

/**
 * Compare geometry rather than pixels.
 *
 * Copy differs between a source and its migration by design, so a pixel diff of
 * a text-heavy region reports differences that are not faults. Box geometry
 * answers the question that actually matters for chrome: is everything the same
 * size, and in the same place?
 */
export async function measureLayout(page, url, selectors) {
  const state = await gotoStable(page, url, { primeLazyLoad: true, reveal: true, freezeMotion: true });
  if (!state.ok) return { ok: false, reason: state.reason };

  const boxes = await page.evaluate((selectors) => {
    const out = {};
    for (const [role, selector] of Object.entries(selectors)) {
      let el = null;
      try {
        el = document.querySelector(selector);
      } catch {
        /* unsupported selector */
      }
      if (!el) {
        out[role] = null;
        continue;
      }
      const r = el.getBoundingClientRect();
      out[role] = {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
    }
    return out;
  }, selectors);

  return { ok: true, boxes };
}

/** Report geometry differences above a tolerance. */
export function compareLayout(sourceBoxes, targetBoxes, { tolerancePx = 8 } = {}) {
  const rows = [];

  for (const role of Object.keys(sourceBoxes)) {
    const a = sourceBoxes[role];
    const b = targetBoxes[role];

    if (!a && !b) continue;
    if (!a || !b) {
      rows.push({ role, status: "missing", detail: !a ? "absent in source" : "absent in target" });
      continue;
    }

    const deltas = {
      x: b.x - a.x,
      y: b.y - a.y,
      width: b.width - a.width,
      height: b.height - a.height,
    };
    const worst = Math.max(...Object.values(deltas).map(Math.abs));

    rows.push({
      role,
      status: worst <= tolerancePx ? "match" : "differs",
      deltas,
      source: a,
      target: b,
    });
  }

  return rows;
}

export function writePng(file, buffer) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buffer);
}
