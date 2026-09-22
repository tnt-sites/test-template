/**
 * Reconcile measured font families against the ones the target actually loads.
 *
 * A font token is the one measurement that fails silently and completely. The
 * source's stylesheet names `Playfair, sans-serif`; the target loads `Playfair
 * Display`. Emitted verbatim the token resolves to nothing, the browser falls
 * back to `sans-serif`, and a footer whose colour, size, weight and spacing all
 * match the original renders its headings in the wrong typeface — while the
 * command reports, accurately, that it measured the source's font.
 *
 * The families are not interchangeable in general ("Playfair" and "Playfair
 * Display" are two different Google families), so the substitution is reported
 * rather than made quietly: it is a judgement that the target's designer can
 * overrule by adding the missing family to `fontLinks`.
 */

const norm = (family) => family.trim().replace(/^["']|["']$/g, "");

/** Families a Google Fonts URL requests: `family=Playfair+Display:...`. */
function familiesFromLink(href) {
  return [...String(href).matchAll(/[?&]family=([^:&]+)/g)].map((m) =>
    decodeURIComponent(m[1]).replace(/\+/g, " ")
  );
}

/** Every family the target has actually arranged to load. */
export function loadedFamilies(branding = {}) {
  const found = new Set();
  for (const link of branding.fontLinks ?? []) {
    for (const family of familiesFromLink(link)) found.add(family);
  }
  for (const key of ["bodyFont", "headingsFont", "buttonsFont"]) {
    const stack = branding[key]?.fontFamily;
    if (!stack) continue;
    const first = norm(String(stack).split(",")[0]);
    if (first) found.add(first);
  }
  return [...found];
}

/**
 * The loaded family that best answers `wanted`, or null.
 *
 * Only same-family relatives count: `Playfair` matches `Playfair Display`
 * because one name is the other plus a style word. `Lato` does not match
 * `Latom`, and nothing matches across families — a missing font is better left
 * missing than replaced with an unrelated one.
 */
export function resolveFamily(wanted, available) {
  const target = norm(wanted);
  if (!target) return null;
  const lower = target.toLowerCase();
  const exact = available.find((f) => f.toLowerCase() === lower);
  if (exact) return exact;
  const words = (f) => f.toLowerCase().split(/\s+/);
  return (
    available.find((f) => {
      const a = words(f);
      const b = words(target);
      const [short, long] = a.length <= b.length ? [a, b] : [b, a];
      return short.every((w, i) => long[i] === w);
    }) ?? null
  );
}

/**
 * Rewrite the font families in a chrome token layer to families the target
 * loads. Returns the CSS plus the substitutions and the families that had no
 * relative at all, for the caller to report.
 */
export function reconcileFonts(css, branding = {}) {
  const available = loadedFamilies(branding);
  if (!available.length) return { css, swapped: [], missing: [] };

  const swapped = [];
  const missing = [];
  const seen = new Set();

  const next = css.replace(
    /(--chrome-[\w-]*font:\s*)([^;]+);/g,
    (whole, prefix, stack) => {
      const parts = stack.split(",").map((p) => p.trim());
      const wanted = norm(parts[0]);
      if (!wanted || GENERIC.has(wanted.toLowerCase())) return whole;
      if (available.some((f) => f.toLowerCase() === wanted.toLowerCase())) return whole;

      const match = resolveFamily(wanted, available);
      const key = `${wanted}→${match ?? ""}`;
      if (!seen.has(key)) {
        seen.add(key);
        (match ? swapped : missing).push(match ? { from: wanted, to: match } : wanted);
      }
      if (!match) return whole;
      return `${prefix}"${match}", ${parts.slice(1).join(", ") || "sans-serif"};`;
    }
  );

  return { css: next, swapped, missing };
}

const GENERIC = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "inherit"]);
