/**
 * Lazy-loaded `<img>` resolution.
 *
 * Lazy-loading plugins (lazysizes, WP Rocket, Smush, jQuery.lazyload) ship an
 * `<img>` with **no `src` at all** — or a placeholder one — and park the real
 * URL in a data attribute that their script swaps in once the element
 * intersects. Taylor Dental Care's interior pages are the canonical shape:
 *
 *   <img class="lazyload" data-src="/wp-content/uploads/…/veneer.jpg" alt="…">
 *
 * Nothing downstream expects that. `img[src]` selectors do not match it, and
 * `getAttribute("src")` returns `""`, so a page's photos vanish from the
 * migration while every text-based check stays green — the veneers page kept
 * all of its prose and lost four of its five images.
 *
 * These are the attribute names and the placeholder shapes; `resolveLazyImages`
 * in `./load.mjs` applies them in the browser, and `srcFromAttrs` applies the
 * same rule to the XML content path, which never loads a browser at all.
 */

/** Where a loader parks the real URL, in the order plugins prefer them. */
export const LAZY_SRC_ATTRS = [
  "data-src",
  "data-lazy-src",
  "data-original",
  "data-echo",
  "data-image-src",
];

/** The `srcset` equivalents. */
export const LAZY_SRCSET_ATTRS = ["data-srcset", "data-lazy-srcset"];

/**
 * Where a *scripted gallery* parks its image URL.
 *
 * The same disappearance as above, one step further out: a page-builder gallery
 * renders no `<img>` at all. Elementor's is the shape seen here — an empty
 * `<div role="img" data-thumbnail="/wp-content/uploads/…/In-the-News.png">`
 * whose background its own script applies at runtime. Before JS the element is
 * a sized, empty box, so `img[src]`, `data-src` and even a computed
 * `background-image` all find nothing, and the homepage's four "In the News"
 * covers migrate as blank outlines.
 *
 * The file is usually already in the mirror (the crawler follows these hrefs);
 * it is only the markup that never references it.
 */
export const GALLERY_THUMB_ATTRS = ["data-thumbnail", "data-large", "data-image"];

/**
 * A stand-in the loader means to replace: an inline data URI (usually a 1x1
 * transparent GIF) or a file whose name says it is a spacer. Anything else is
 * a real image and must win over the data attribute, since a plugin can leave
 * a stale `data-src` behind after the swap has already happened.
 */
export const PLACEHOLDER_SRC =
  /^data:|(?:^|\/)(?:blank|spacer|placeholder|transparent|lazy|loader|dummy)[-\w]*\.(?:gif|png|svg|webp)(?:[?#]|$)/i;

/**
 * Resolve the real image URL from an attribute lookup.
 *
 * `getAttr` takes an attribute name and returns its value or null, so this
 * serves a DOM element and an XML/HTML node parsed in Node alike.
 * Returns "" when there is no usable URL.
 */
export function srcFromAttrs(getAttr) {
  const src = (getAttr("src") || "").trim();
  if (src && !PLACEHOLDER_SRC.test(src)) return src;

  for (const name of LAZY_SRC_ATTRS) {
    const value = (getAttr(name) || "").trim();
    if (value && !PLACEHOLDER_SRC.test(value)) return value;
  }
  return src;
}
