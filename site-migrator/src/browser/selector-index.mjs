import { UID_ATTR } from "../mirror/instrument.mjs";

/**
 * Tier-1 selector matching: map every source selector to the uids it matches,
 * plus the rendered area of each element.
 *
 * Rendered area is what makes palette extraction trustworthy. Counting colour
 * *literals* in a stylesheet ranks a one-off `#ccc` on a hidden element equal
 * with the site's body background; weighting by the pixels a colour actually
 * covers puts them in the right order. The previous toolkit ranked by "how many
 * pages contain this colour", which gave every colour an identical score.
 *
 * This runs one `page.evaluate` per page for the whole selector set — cheap.
 * The precise-but-expensive CDP pass is reserved for synthesized subtrees.
 */

export async function buildSelectorIndex(page, selectors) {
  return page.evaluate(
    ({ selectors, attr }) => {
      const matches = {};
      const areas = {};
      let totalArea = 0;

      const all = document.querySelectorAll(`[${attr}]`);
      for (const el of all) {
        const r = el.getBoundingClientRect();
        const uid = el.getAttribute(attr);
        const area = Math.max(0, r.width) * Math.max(0, r.height);
        areas[uid] = area;
        totalArea += area;
      }

      for (const sel of selectors) {
        let matched;
        try {
          matched = document.querySelectorAll(sel);
        } catch {
          continue; // legacy or invalid selector — skip rather than abort
        }
        if (matched.length === 0) continue;

        const uids = [];
        for (const el of matched) {
          const uid = el.getAttribute(attr);
          if (uid) uids.push(uid);
        }
        if (uids.length) matches[sel] = uids;
      }

      return { matches, areas, totalArea, elementCount: all.length };
    },
    { selectors, attr: UID_ATTR }
  );
}

/**
 * Combine per-page role measurements into one site-wide answer.
 *
 * A single page can be unrepresentative — a landing page with an inverted
 * colour scheme, or one where the only `<h2>` sits on a dark band. Taking the
 * value most pages agree on avoids letting one outlier define a token.
 */
export function mergeMeasurements(perPage) {
  const groups = ["body", "paragraph", "h1", "h2", "h3", "link"];
  const merged = {};

  for (const group of groups) {
    const votes = new Map();

    for (const measurement of perPage) {
      const entry = measurement?.[group];
      if (!entry) continue;
      for (const [prop, value] of Object.entries(entry)) {
        if (prop.startsWith("_")) continue;
        if (!votes.has(prop)) votes.set(prop, new Map());
        const bucket = votes.get(prop);
        bucket.set(value, (bucket.get(value) ?? 0) + 1);
      }
    }

    if (votes.size === 0) {
      merged[group] = null;
      continue;
    }

    const out = {};
    for (const [prop, bucket] of votes) {
      let best = null;
      let bestVotes = -1;
      for (const [value, count] of bucket) {
        if (count > bestVotes) {
          bestVotes = count;
          best = value;
        }
      }
      out[prop] = best;
    }
    merged[group] = out;
  }

  return merged;
}

/** Merge per-page indexes into one site-wide view. */
export function mergeIndexes(indexes) {
  const selectorUids = new Map();
  const areaByUid = new Map();
  let totalArea = 0;
  let elementCount = 0;

  for (const idx of indexes) {
    for (const [sel, uids] of Object.entries(idx.matches)) {
      if (!selectorUids.has(sel)) selectorUids.set(sel, []);
      selectorUids.get(sel).push(...uids);
    }
    for (const [uid, area] of Object.entries(idx.areas)) {
      areaByUid.set(uid, area);
    }
    totalArea += idx.totalArea;
    elementCount += idx.elementCount;
  }

  return { selectorUids, areaByUid, totalArea, elementCount };
}

/** Total rendered area a selector covers across the site. */
export function areaForSelector(index, selector) {
  const uids = index.selectorUids.get(selector);
  if (!uids) return 0;
  let sum = 0;
  for (const uid of uids) sum += index.areaByUid.get(uid) ?? 0;
  return sum;
}

/**
 * A selector matching a large share of the site is effectively global styling
 * (`p`, `a`, `main ul li`). Those belong in the shared source-base layer, not
 * baked into one component's scoped block where they would leak out.
 */
export function isBroadSelector(index, selector, share) {
  const uids = index.selectorUids.get(selector);
  if (!uids) return false;
  return uids.length / Math.max(index.elementCount, 1) > share;
}

/**
 * Measure the computed values that token roles are derived from.
 *
 * Every property is resolved to the value covering the most rendered area
 * across all matching elements — never the first match. Taking the first `<p>`
 * on a page picks up whatever happens to sit at the top of the document, which
 * on a site with a dark hero is white text on a dark band rather than the body
 * copy colour used by the other 95% of the page. That single shortcut is what
 * made the previous toolkit report a 14px eyebrow as the site's `h1` style.
 */
export async function measureRoles(page, scope = {}) {
  return page.evaluate((scope) => {
    const TYPOGRAPHY = [
      "font-family",
      "font-size",
      "font-weight",
      "line-height",
      "letter-spacing",
      "text-transform",
      "color",
    ];

    const roots = (scope.contentRoots ?? []).flatMap((sel) => {
      try {
        return [...document.querySelectorAll(sel)];
      } catch {
        return [];
      }
    });
    const searchRoots = roots.length ? roots : [document.body];

    const chrome = (scope.chromeSelectors ?? []).flatMap((sel) => {
      try {
        return [...document.querySelectorAll(sel)];
      } catch {
        return [];
      }
    });
    const inChrome = (el) => chrome.some((c) => c.contains(el));

    const pageBackground = getComputedStyle(document.body).backgroundColor;

    /** Nearest ancestor background that is actually painted. */
    const effectiveBackground = (el) => {
      for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
        const bg = getComputedStyle(node).backgroundColor;
        const m = bg.match(/rgba?\(([^)]+)\)/);
        if (!m) continue;
        const parts = m[1].split(",").map((n) => parseFloat(n));
        const alpha = parts.length > 3 ? parts[3] : 1;
        if (alpha > 0.05) return bg;
      }
      return pageBackground;
    };

    /** Relative luminance, for deciding whether a surface reads light or dark. */
    const luminance = (color) => {
      const m = color.match(/rgba?\(([^)]+)\)/);
      if (!m) return 1;
      const [r, g, b] = m[1].split(",").map((n) => parseFloat(n) / 255);
      const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };

    const pageIsLight = luminance(pageBackground) > 0.5;

    /**
     * A default token describes how something looks on the site's normal
     * surface. Headings and links inside inverted hero or CTA bands are white
     * by design and would otherwise dominate by area on a homepage — in the
     * target those bands are a section colour scheme, not the default.
     *
     * Matching on background *polarity* rather than exact equality matters:
     * sites routinely alternate several near-identical light surfaces, and
     * demanding an exact match would discard almost all real body content.
     */
    const onDefaultSurface = (el) => (luminance(effectiveBackground(el)) > 0.5) === pageIsLight;

    /** Area-weighted mode of each property across every matching element. */
    const dominant = (selector, props) => {
      let elements;
      try {
        elements = searchRoots.flatMap((root) => [...root.querySelectorAll(selector)]);
      } catch {
        return null;
      }

      // Navigation and footer links are white on dark bands and outweigh body
      // copy by area, so leaving them in makes `--color-link` white. Chrome
      // gets its own colours as component props instead.
      elements = elements.filter((el) => !inChrome(el));

      // Prefer elements on the default surface; fall back to all of them if a
      // page genuinely has none (a fully inverted landing page, say).
      const onDefault = elements.filter(onDefaultSurface);
      if (onDefault.length) elements = onDefault;

      if (elements.length === 0) return null;

      const tally = Object.fromEntries(props.map((p) => [p, new Map()]));
      let counted = 0;

      for (const el of elements) {
        const rect = el.getBoundingClientRect();
        const area = Math.max(0, rect.width) * Math.max(0, rect.height);
        if (area <= 0) continue; // hidden or zero-size elements carry no weight

        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none") continue;

        counted++;
        for (const prop of props) {
          const value = cs.getPropertyValue(prop);
          if (!value) continue;
          const bucket = tally[prop];
          bucket.set(value, (bucket.get(value) ?? 0) + area);
        }
      }

      if (counted === 0) return null;

      const out = {};
      for (const prop of props) {
        let best = null;
        let bestArea = -1;
        for (const [value, area] of tally[prop]) {
          if (area > bestArea) {
            bestArea = area;
            best = value;
          }
        }
        if (best !== null) out[prop] = best;
      }
      out._sampled = counted;
      return out;
    };

    // `body` is a single element outside any content root, so read it directly.
    const bodyStyle = (() => {
      const cs = getComputedStyle(document.body);
      const out = {};
      for (const p of [...TYPOGRAPHY, "background-color"]) out[p] = cs.getPropertyValue(p);
      return out;
    })();

    return {
      body: bodyStyle,
      paragraph: dominant("p", TYPOGRAPHY),
      h1: dominant("h1, .h1", TYPOGRAPHY),
      h2: dominant("h2, .h2", TYPOGRAPHY),
      h3: dominant("h3, .h3", TYPOGRAPHY),
      link: dominant("a", ["color", "text-decoration-line"]),
      // Hover state cannot be read from computed style; it is recovered from
      // the `a:hover` rule in the AST instead.
    };
  }, scope);
}
