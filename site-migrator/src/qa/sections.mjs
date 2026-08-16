import { gotoStable } from "../browser/load.mjs";

/**
 * Per-section geometry checks for a hand-ported page.
 *
 * `mig content` maps repeated section patterns onto template components, and
 * that mapping is what `scan`/`content` already report on. A *bespoke* page —
 * a homepage, typically — is ported the other way round: one new component per
 * section, keeping the source's own ids, markup and CSS. Nothing in the
 * pipeline verifies the result, and every fault that survives that port is
 * silent in the same way: the page renders, the build passes, and the section
 * is simply the wrong height.
 *
 * Height is the diagnostic worth automating. A ported section that lost a
 * media-query wrapper, a `min-width`, a plugin's stylesheet or a heading margin
 * reset does not disappear — it comes out 20px, or 800px, off. Comparing
 * heights per section attributes that to the section that owns it, which a
 * full-page pixel diff cannot do: one section 24px tall pushes everything below
 * it out of alignment and reports as a total mismatch.
 *
 * This pass only means anything when the ported components kept the source's
 * ids, which is what makes the two sides pairable at all. That is the same
 * constraint the porting approach already imposes for the source's CSS to
 * apply unchanged, so it costs nothing extra.
 */

/**
 * Enumerate the source page's sections, in document order.
 *
 * Identity is the element's `id`, not its position: a source page routinely
 * restructures its own DOM on load, and the migrated page has a different
 * number of wrapper elements around the same sections. Pairing by index would
 * misalign the moment either side gains or loses a node, and would then report
 * every section after the first difference as wrong.
 *
 * Only elements that carry an id are considered. An unidentified section cannot
 * be paired with anything on the other side, so counting it would produce a
 * finding no one can act on.
 *
 * Outermost identified element wins. Ids nested inside an already-claimed
 * section are that section's internals, not sections — and the ones a carousel
 * library stamps on its own slides at runtime (`slick-slide00`, `prev`, `next`)
 * exist only on whichever side still runs that library. Counted as sections,
 * they report as missing on the other side and send a reader hunting for a
 * section that was never dropped.
 */
export async function readSectionIds(page, url, roots = ["main"]) {
  const state = await gotoStable(page, url, { primeLazyLoad: true, reveal: true });
  if (!state.ok) return { ok: false, reason: state.reason };

  const ids = await page.evaluate((roots) => {
    const containers = roots
      .map((selector) => {
        try {
          return document.querySelector(selector);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    const scope = containers.length ? containers : [document.body];
    const kept = [];

    for (const container of scope) {
      // Descendants, not just children: the source may wrap its sections in a
      // page-level div (`.full-page`) that the migration does not reproduce.
      for (const el of container.querySelectorAll("[id]")) {
        const id = el.id;
        if (!id || kept.some((entry) => entry.id === id)) continue;

        // Anchor targets and skip-links are ids too, and they are not sections.
        // A section is something with real height that holds content.
        if (el.getBoundingClientRect().height < 40) continue;

        // Inside a section already claimed → part of that section, not a peer.
        if (kept.some((entry) => entry.el.contains(el))) continue;

        kept.push({ id, el });
      }
    }

    return kept.map((entry) => entry.id);
  }, roots);

  return { ok: true, ids };
}

/**
 * Measure each section by id.
 *
 * `top` is recorded but not compared: vertical offset accumulates down the page,
 * so once one section differs every section below it does too. Reporting that
 * as dozens of failures buries the one that actually caused them. Height is
 * per-section and independent, so it points at the owner.
 */
export async function measureSections(page, url, ids) {
  const state = await gotoStable(page, url, {
    primeLazyLoad: true,
    reveal: true,
    freezeMotion: true,
  });
  if (!state.ok) return { ok: false, reason: state.reason };

  const measured = await page.evaluate((ids) => {
    const out = { __total: Math.round(document.body.scrollHeight) };

    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el) {
        out[id] = null;
        continue;
      }
      const r = el.getBoundingClientRect();
      out[id] = {
        top: Math.round(r.top + window.scrollY),
        height: Math.round(r.height),
        width: Math.round(r.width),
      };
    }

    return out;
  }, ids);

  const total = measured.__total;
  delete measured.__total;
  return { ok: true, sections: measured, total };
}

/**
 * Compare section heights, plus the page total.
 *
 * A section absent from the migrated page is reported as `missing` rather than
 * skipped — that is the loudest possible symptom of a bespoke section having
 * been flattened onto a generic component, and it is the failure the porting
 * approach exists to prevent.
 */
export function compareSections(source, target, { tolerancePx = 8 } = {}) {
  const rows = [];

  for (const id of Object.keys(source)) {
    const a = source[id];
    const b = target[id];

    if (!a) continue;
    if (!b) {
      rows.push({ id, status: "missing", source: a.height });
      continue;
    }

    const delta = b.height - a.height;
    rows.push({
      id,
      status: Math.abs(delta) <= tolerancePx ? "match" : "differs",
      source: a.height,
      target: b.height,
      delta,
    });
  }

  return rows;
}

/**
 * How much of the page-length difference the per-section rows account for.
 *
 * When the totals differ but every section matches, the remainder is in the
 * chrome or in gaps between sections — margins collapsing differently, or a
 * wrapper the migration added. Saying so is more useful than reporting a clean
 * section table next to a page that is visibly 200px too long.
 */
export function residual(rows, sourceTotal, targetTotal) {
  const accounted = rows
    .filter((row) => row.status !== "missing")
    .reduce((sum, row) => sum + (row.delta ?? 0), 0);

  return { total: targetTotal - sourceTotal, accounted, unaccounted: targetTotal - sourceTotal - accounted };
}
