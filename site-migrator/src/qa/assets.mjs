import { gotoStable } from "../browser/load.mjs";

/**
 * Flags `<img>` elements on the migrated page whose file never loaded.
 *
 * `collectContentAssets` (src/content/index.mjs) copies every image the
 * content it is given references — it is not the bug. The gap is upstream:
 * nothing re-runs it when content changes after the fact. A page hand-edited
 * post-`mig content` (a corrected `imageSource`, a manually completed array
 * item) keeps the new path in the markdown but never triggers a copy, so the
 * build succeeds and the page renders with a silently broken `<img>` — no
 * height change, no build error, nothing any other pass here catches.
 *
 * This is a live-DOM check rather than a static content scan so it also
 * catches the same fault from any other source (a bad hand-typed path, an
 * asset deleted from `public/` after the fact, and so on).
 */
export async function findBrokenImages(page, url) {
  const state = await gotoStable(page, url, { primeLazyLoad: true });

  if (!state.ok) return { ok: false, reason: state.reason };

  const images = await page.evaluate(() =>
    Array.from(document.images).map((img) => ({
      src: img.currentSrc || img.getAttribute("src") || "",
      alt: img.alt || "",
      broken: img.complete && img.naturalWidth === 0,
    }))
  );

  return { ok: true, broken: images.filter((img) => img.broken && img.src) };
}

/**
 * How large each image is actually drawn, keyed by filename.
 *
 * The fault this is for: a source photo that renders at its own intrinsic size
 * comes out stretched to fill whatever box the template component gives it.
 * `Image.astro` — and the equivalent in every starter — sets `width: 100%` on
 * the `<img>`, because it is written for art-directed photography that should
 * fill its slot. A source of this vintage does the opposite: it drops an
 * `<img>` into a centred container with no width rule at all, and the browser
 * draws it at the file's own dimensions.
 *
 * On the page that prompted this, a 675x450 gallery photo was drawn at 1000px
 * wide — upscaled 1.48x, blurred, and cropping differently at every breakpoint
 * from the source. Nothing else here sees it: the image is inside a carousel
 * slide, so the section around it is sized by the tallest slide either way; it
 * loaded fine, so the broken-image check passes; and it carries no text.
 *
 * Both sides are measured and paired by basename because the source is the
 * authority on the intended size. A bare "is this upscaled past its intrinsic
 * width" test would flag every legitimately full-bleed hero in the template.
 */
export async function readImageBoxes(page, url, { roots = ["main"], minWidth = 40 } = {}) {
  const state = await gotoStable(page, url, {
    primeLazyLoad: true,
    reveal: true,
    // A source page's own scripts keep running after `load` — a slider
    // advancing, a scroll-triggered reveal rewriting the DOM. Without this the
    // read races them and Playwright tears the execution context out from under
    // `evaluate`, which throws rather than returning, and takes the whole `qa`
    // run down with it.
    freezeMotion: true,
  });

  if (!state.ok) return { ok: false, reason: state.reason };

  const images = await page.evaluate(
    ({ roots, minWidth }) => {
      const scopes = roots.flatMap((sel) => [...document.querySelectorAll(sel)]);
      const searchIn = scopes.length ? scopes : [document.body];

      const seen = new Set();
      const rows = [];

      for (const scope of searchIn) {
        for (const img of scope.querySelectorAll("img")) {
          const rect = img.getBoundingClientRect();

          if (rect.width < minWidth) continue;

          // Basename only. The two sides serve the same asset from different
          // paths by design, and a responsive `srcset` candidate carries a
          // build hash the source's copy never had.
          const src = img.currentSrc || img.getAttribute("src") || "";
          const name = (src.split("?")[0].split("/").pop() || "").toLowerCase();

          if (!name || seen.has(name)) continue;
          seen.add(name);

          rows.push({
            name,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            natural: img.naturalWidth,
          });
        }
      }
      return rows;
    },
    { roots, minWidth }
  );

  return { ok: true, images };
}

/**
 * Pair rendered image boxes by filename and report the ones the port resized.
 *
 * `upscaled` rides along on the target row because it is what makes a width
 * difference worth acting on rather than a judgement call: a photo drawn wider
 * than the pixels it has is visibly soft, whatever the source did.
 */
export function compareImageBoxes(source, target, { tolerancePx = 8 } = {}) {
  const byName = new Map(source.map((img) => [img.name, img]));

  return target
    .map((b) => {
      const a = byName.get(b.name);

      if (!a) return null;
      const delta = b.width - a.width;

      if (Math.abs(delta) <= tolerancePx) return null;
      return {
        name: b.name,
        source: `${a.width}x${a.height}`,
        target: `${b.width}x${b.height}`,
        delta,
        upscaled: b.natural > 0 && b.width > b.natural + tolerancePx,
        intrinsic: b.natural,
      };
    })
    .filter(Boolean);
}
