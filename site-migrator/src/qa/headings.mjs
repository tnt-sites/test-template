import { gotoStable } from "../browser/load.mjs";

/**
 * Heading typography, source vs migrated.
 *
 * Every other QA pass here measures *boxes*. Boxes do not catch the single most
 * repeated fault in a hand-port: a heading that kept its text and its place but
 * took the template's type instead of the source's.
 *
 * It survives everything else because it is cheap to miss and looks deliberate.
 * `map-to-component` hands the heading string to the template's `Heading`, which
 * carries its own size ramp, its own `margin-top`, and — in a CloudCannon
 * starter — a `.color` / `.heading-color` span convention for accenting a word.
 * None of that came from the source. The section still renders, the build still
 * passes, the text is right, and the height lands inside the geometry
 * tolerance whenever the heading is one line. What ships is a heading at the
 * wrong size, in the wrong family, un-uppercased, with one word painted the
 * brand colour that the source paints like every other word.
 *
 * The two halves this checks are exactly those:
 *
 *   1. Computed type — family, size, weight, line-height, transform, colour,
 *      letter-spacing — must match the source element with the same text.
 *   2. Accents — a descendant painted a different colour than the heading
 *      itself is a highlight. It is a fault unless the source has one too.
 *
 * Pairing is by text, not by position or id. A heading is the one thing on a
 * page guaranteed to survive a port verbatim — that is what makes it a heading —
 * whereas the element around it routinely changes tag, id, class and depth
 * (`<span>` in the source, `<h6 class="heading">` in the template). Text is the
 * only handle that holds across all of that.
 */

/** Type properties worth comparing. Layout properties belong to the geometry pass. */
const TYPE_PROPS = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "textTransform",
  "color",
];

/**
 * Collect every heading-like element on a page with its computed type.
 *
 * "Heading-like" is deliberately not `h1..h6`. Sources of this vintage write
 * display text as `<span class="h2">` or a bare `<span>` inside a block that
 * styles it, precisely so it stays out of the document outline — and the
 * migrated side usually *is* a real heading tag. Keying on the tag would skip
 * the source element and leave nothing to compare against.
 *
 * So the test is visual instead: text that renders substantially larger than
 * body copy, is short enough to be a title rather than a paragraph, and has no
 * descendant that is itself a candidate (which keeps the wrapper out when a
 * block and its inner span both qualify — the inner one owns the type).
 */
export async function readHeadings(page, url, { roots = ["main"], minScale = 1.4 } = {}) {
  const state = await gotoStable(page, url, { primeLazyLoad: true, reveal: true });
  if (!state.ok) return { ok: false, reason: state.reason };

  const headings = await page.evaluate(
    ([roots, minScale, props]) => {
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
      const bodySize = parseFloat(getComputedStyle(document.body).fontSize) || 16;
      const clean = (el) => (el.textContent || "").replace(/\s+/g, " ").trim();

      const isCandidate = (el) => {
        const text = clean(el);
        if (!text || text.length > 120) return false;

        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") return false;
        if (el.getClientRects().length === 0) return false;

        if (/^H[1-6]$/.test(el.tagName)) return true;
        return parseFloat(cs.fontSize) >= bodySize * minScale;
      };

      const found = [];
      for (const container of scope) {
        for (const el of container.querySelectorAll("*")) {
          if (!isCandidate(el)) continue;
          // A descendant candidate owns the type; this element is its wrapper.
          if ([...el.querySelectorAll("*")].some(isCandidate)) continue;
          found.push(el);
        }
      }

      return found.map((el) => {
        const cs = getComputedStyle(el);
        const type = {};
        for (const prop of props) type[prop] = cs[prop];

        return {
          text: clean(el),
          tag: el.tagName.toLowerCase(),
          type,
          // Descendants painted differently from the heading itself. Reported
          // as selectors so a fault names the span to delete.
          accents: [...el.querySelectorAll("*")]
            .filter((child) => clean(child) && getComputedStyle(child).color !== cs.color)
            .map((child) => {
              const cls = String(child.getAttribute("class") || "")
                .split(/\s+/)
                .filter(Boolean)
                .map((name) => `.${name}`)
                .join("");
              return `${child.tagName.toLowerCase()}${cls}`;
            }),
        };
      });
    },
    [roots, minScale, TYPE_PROPS]
  );

  return { ok: true, headings };
}

/**
 * Normalise a computed value so equal renderings compare equal.
 *
 * Lengths come back sub-pixel (`55.199997px`) and differ between a `1.2`
 * unitless line-height and a `55.2px` one that renders identically; `normal`
 * letter-spacing resolves to `0px` on one side and stays `normal` on the other.
 * Rounding lengths and folding `normal` to `0px` removes both without hiding a
 * real difference — nothing this catches is smaller than a pixel.
 */
function normalise(value) {
  if (value === "normal") return "0px";
  const px = /^(-?[\d.]+)px$/.exec(String(value));
  if (px) return `${Math.round(Number(px[1]))}px`;
  return String(value).trim();
}

/**
 * Pair headings by text and report the pairs whose type differs.
 *
 * Only matched pairs are reported. A heading present on one side alone is a
 * content difference, which `content-parity` already covers, and surfacing it
 * here would bury the type findings under every nav label and card title that
 * legitimately exists on one page and not the other.
 *
 * Text is matched case-insensitively: `text-transform: uppercase` changes the
 * rendering, not the DOM, but a source that hard-codes the caps in its markup
 * and a migration that applies them in CSS are the *same* heading, and the
 * transform mismatch is reported as a property rather than as two headings that
 * failed to pair.
 */
export function compareHeadings(sourceHeadings, targetHeadings) {
  const key = (heading) => heading.text.toLocaleLowerCase();
  const targetsByKey = new Map();
  for (const heading of targetHeadings) {
    if (!targetsByKey.has(key(heading))) targetsByKey.set(key(heading), heading);
  }

  const rows = [];
  const claimed = new Set();

  for (const source of sourceHeadings) {
    const target = targetsByKey.get(key(source));
    if (!target || claimed.has(target)) continue;
    claimed.add(target);

    const differences = [];
    for (const prop of TYPE_PROPS) {
      const a = normalise(source.type[prop]);
      const b = normalise(target.type[prop]);
      if (a !== b) differences.push({ prop, source: source.type[prop], target: target.type[prop] });
    }

    // An accent the source does not have is the `.color` span convention
    // leaking in from the template's structure defaults. Reported separately
    // from the type properties because the fix is in the *content*, not the CSS:
    // the highlight span has to come out of the heading string.
    const addedAccents = target.accents.filter((accent) => source.accents.length === 0);

    rows.push({
      text: source.text,
      sourceTag: source.tag,
      targetTag: target.tag,
      status: differences.length === 0 && addedAccents.length === 0 ? "match" : "differs",
      differences,
      addedAccents,
    });
  }

  return rows;
}
