/**
 * Source-to-source edits on an already-emitted component.
 *
 * The consolidation pass reshapes components that are already on disk — renaming
 * props, guarding slots that became optional, switching a slot to raw injection,
 * lifting per-instance image dimensions out to props. Each of these is a small,
 * checked rewrite of the `.astro` text.
 *
 * Deriving a component's *prop types* this way was tried and removed: the
 * markup does not carry enough to tell a `textarea` from a `text`, and an
 * array's item fields disappeared whenever its `.map(` sat on its own line,
 * which silently emptied the array editor in CloudCannon. Sidecars are
 * transformed from the originals instead — see `sidecars.mjs`.
 */

/**
 * Rename props throughout a component: the destructuring block, every use in
 * the markup, and the CSS custom properties threaded off them.
 *
 * Renames are applied simultaneously. Doing them one at a time would let a
 * swap like `{heading: "eyebrow", subheading: "heading"}` collide, folding both
 * props into one — which is exactly the shape the page-banner merge needs.
 */
export function renameProps(source, rename) {
  const names = Object.keys(rename);

  if (!names.length) return source;

  const pattern = new RegExp(`(?<![\\w$.])(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\w$])`, "g");

  return source.replace(pattern, (m) => rename[m] ?? m);
}

/**
 * Wrap a prop's element in a truthiness guard, if it isn't already.
 *
 * The generator emits a slot unguarded when the page it captured always had
 * content for it. Merging brings in members that don't, so those slots have to
 * become conditional or they render as empty elements.
 */
export function guardSlots(source, propNames) {
  let out = source;

  for (const prop of propNames) {
    const unguarded = new RegExp(
      `^(\\s*)(<([a-z][a-z0-9]*)\\b[^>]*>\\{${prop}\\}</\\3>)\\s*$`,
      "gm"
    );

    out = out.replace(unguarded, (m, indent, element) => `${indent}{${prop} && ${element}}`);
  }
  return out;
}

/**
 * Switch a slot from interpolation to raw injection.
 *
 * `<h2 class="x">{prop}</h2>` becomes `<h2 class="x" set:html={prop} />`, the
 * form the generator emits for rich-text slots. Used when merging components
 * whose slots disagree on escaping: the merged component injects raw wherever
 * any member did, and the members that interpolated have their stored content
 * escaped to match.
 */
export function promoteSlotsToRaw(source, propNames) {
  let out = source;

  for (const prop of propNames) {
    const interpolated = new RegExp(
      `(<([a-z][a-z0-9]*)\\b[^>]*?)>\\{${prop}\\}</\\2>`,
      "g"
    );

    out = out.replace(interpolated, (_m, open) => `${open} set:html={${prop}} />`);
  }
  return out;
}

/**
 * HTML-escape a value so raw injection renders what interpolation used to.
 *
 * Only the three characters that change meaning inside markup; quotes are left
 * alone because these values land in text nodes, never in attributes.
 */
export function escapeForRaw(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Turn an `<img>`'s baked `width`/`height` into props.
 *
 * The literal dimensions belong to whichever page's image the generator
 * measured. Once a component is shared, they have to travel with the content,
 * so each becomes a prop defaulting to the value that was baked in — pages that
 * do not set it render exactly as before.
 */
export function liftImageDimensions(source, imageProps, canonicalDims) {
  let out = source;

  for (const prop of imageProps) {
    const dim = canonicalDims[prop];

    if (!dim) continue;
    out = out.replace(
      new RegExp(`(\\bsrc=\\{${prop}\\}[^>]*?)\\bwidth="\\d+"\\s+height="\\d+"`),
      `$1width={${prop}Width || ${dim.w}} height={${prop}Height || ${dim.h}}`
    );

    // Declare the new props alongside the one that supplies the src.
    out = out.replace(
      new RegExp(`^(\\s*)${prop} = ("(?:[^"\\\\]|\\\\.)*"|\\[\\]),$`, "m"),
      `$1${prop} = $2,\n$1${prop}Width = "",\n$1${prop}Height = "",`
    );
  }
  return out;
}
