/**
 * Naming contract with the target repo's component loader.
 *
 * renderBlock.astro derives each component's key by kebab-casing its filename
 * and collapsing it into the parent folder when they match. If a generated
 * name doesn't round-trip through that exact transform, the component is
 * silently unresolvable (a console.warn at render time is all you get) — so
 * every name is validated here before anything is written.
 */

/** Byte-for-byte port of renderBlock.astro's pascalToKebab. */
export function pascalToKebab(pascal) {
  return pascal
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/^-/, "");
}

export function kebabToPascal(kebab) {
  return kebab
    .split("-")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}

export function kebabToCamel(kebab) {
  const pascal = kebabToPascal(kebab);
  return pascal ? pascal[0].toLowerCase() + pascal.slice(1) : pascal;
}

export function kebabToSnake(kebab) {
  return kebab.replace(/-/g, "_");
}

export function titleCase(kebab) {
  return kebab
    .split("-")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Validate a kebab component name: it must survive kebab → Pascal → kebab.
 * Names with digit-letter boundaries (e.g. "hero-2col") don't, and would
 * register under a different key than the folder.
 */
/** The exact condition assertRoundTrips enforces, as a predicate. */
export function isValidName(kebab) {
  if (!KEBAB.test(kebab)) return false;
  return pascalToKebab(kebabToPascal(kebab)) === kebab;
}

const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export function assertRoundTrips(kebab) {
  if (!KEBAB.test(kebab)) {
    throw new Error(`component name must be kebab-case: ${JSON.stringify(kebab)}`);
  }
  const pascal = kebabToPascal(kebab);
  const back = pascalToKebab(pascal);
  if (back !== kebab) {
    throw new Error(
      `component name "${kebab}" does not round-trip (${pascal} → ${back}); ` +
        `renderBlock.astro would register it under a different key`
    );
  }
  return { kebab, pascal };
}

/**
 * Derive a kebab-case component name from a captured section's content: the
 * first heading, or its leading text, or a generic fallback — slugified and
 * repaired until it round-trips through pascalToKebab.
 */
export function nameFromContent(tree, fallback) {
  const stack = [tree];
  let seed = null;
  while (stack.length) {
    const node = stack.shift();
    if (["heading", "text"].includes(node.kind) && node.text) {
      seed = node.text;
      break;
    }
    stack.push(...(node.children || []));
  }
  seed = seed || fallback;

  let slug = seed
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .filter(Boolean)
    .slice(0, 4)
    .join("-");

  // A name has to start with a letter, and popping from the end can never fix a
  // leading digit — "24-7-emergency-care" would shrink to "24" and still be
  // invalid, failing the whole page over a section heading that starts with a
  // number. Drop the offending leading segments instead.
  while (slug && !/^[a-z]/.test(slug)) slug = slug.split("-").slice(1).join("-");

  // Round-trip repair: drop segments that don't survive kebab -> Pascal -> kebab
  // (a digit-letter boundary, a bare acronym) rather than fail the whole name.
  if (!slug) slug = fallback;
  while (slug && !isValidName(slug)) {
    const parts = slug.split("-");
    if (parts.length <= 1) {
      slug = fallback;
      break;
    }
    parts.pop();
    slug = parts.join("-");
  }
  return isValidName(slug) ? slug : fallback;
}

/**
 * Short class-name prefix from a kebab name: "tour-cards" → "tc".
 *
 * `taken` holds the prefixes other components already own. Without it the
 * four-letter truncation collides constantly on a real site — `card-grid-home-
 * chao` and `card-grid-home-cosmetic` are both `cghc`, `media-prose-what` and
 * `media-prose-who` are both `mpw` — and two components then write the same
 * class names. Astro's scoping keeps the pages rendering, but every tool that
 * maps a class back to the component that owns it (dev-refix, dev-verify's
 * reporting) silently attributes half of them to the wrong file, and a
 * correction measured on one page lands in the other component.
 *
 * A collision is broken by spending more of the last word, then by a counter.
 */
export function initialsOf(kebab, taken) {
  const parts = kebab.split("-").filter(Boolean);
  const base = parts.length === 1 ? parts[0].slice(0, 2) : parts.map((p) => p[0]).join("").slice(0, 4);

  if (!taken || !taken.has(base)) return base;

  const last = parts[parts.length - 1] || "";

  for (let extra = 1; extra < last.length; extra += 1) {
    const candidate = base + last.slice(1, 1 + extra);

    if (!taken.has(candidate)) return candidate;
  }
  for (let i = 2; ; i += 1) {
    const candidate = `${base}${i}`;

    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Derive a component name from a section's *shape* rather than its words.
 *
 * `nameFromContent` seeds the name from the first heading, which is why the
 * same page banner arrived as `aetna-dental`, `delta-dental`, `sitemap` and 45
 * more. Reuse is decided on structure (see `structure-hash.mjs`), so the name
 * is only a label — but a label that says what the component *is* keeps the
 * CloudCannon component picker readable, and stops a shared component from
 * being named after whichever page happened to capture it first.
 *
 * Returns null when the shape is not one of the recognised families; the caller
 * falls back to `nameFromContent`, which is still the better answer for a
 * genuinely one-off section.
 */
export function nameFromShape(tree, { hasBackgroundImage = false } = {}) {
  const counts = { heading: 0, text: 0, image: 0, button: 0, list: 0, embed: 0, richtext: 0 };
  const walk = (node) => {
    const k = node.kind === "img" ? "image" : node.kind;
    if (k in counts) counts[k] += 1;
    for (const c of node.children || []) walk(c);
  };
  walk(tree);

  const prose = counts.text + counts.richtext;
  const media = counts.image + counts.embed;

  // A page hero is a heading over a background image. The call-to-action is
  // optional and must NOT gate the match: on the toothbar site 21 of 24 heroes
  // carried a "BECOME A PATIENT" button, so a `button === 0` test sent every
  // one of them to `nameFromContent`, which named them after their page
  // heading ("Contact Toothbar", "Cavities & Fillings Austin") and left the
  // registry unable to see them as one family.
  if (hasBackgroundImage && counts.heading >= 1 && prose === 0 && media === 0) {
    return "page-hero";
  }
  // A bare run of text with no heading: the breadcrumb trail, or a lead
  // paragraph. Both are prose as far as the template is concerned.
  if (counts.heading === 0 && prose >= 1 && media === 0 && counts.button === 0) return "prose-block";
  // Heading plus a call to action, no supporting body or imagery.
  if (counts.heading >= 1 && counts.button >= 1 && prose <= 1 && media === 0) return "cta-band";
  if (counts.list >= 1 && counts.heading >= 1) return "card-grid";
  if (media >= 1 && counts.heading >= 1 && prose >= 1) return "media-prose";
  if (media === 0 && counts.heading >= 1 && prose >= 1) return "prose-block";
  if (media >= 1 && counts.heading === 0 && prose === 0) return "photo-mosaic";
  return null;
}
