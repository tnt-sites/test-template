import { converter, differenceEuclidean, formatHex, parse as parseColor } from "culori";

const toOklch = converter("oklch");
const dE = differenceEuclidean("oklch");

/**
 * Port the *visual* properties of the source's header and footer onto the
 * template's own chrome components.
 *
 * The markup and interaction stay the template's — its dropdown behaviour, its
 * mobile menu, its accessibility work. Only the things that make the chrome
 * recognisably this site are carried over: colours, type, weight, size and the
 * band backgrounds. That split is what keeps the result maintainable while
 * still looking like the site it replaced.
 */

/** Properties worth porting. Layout is deliberately excluded — see `emitChromeStyles`. */
export const PORTED_PROPERTIES = [
  "color",
  "background-color",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "line-height",
  "letter-spacing",
  "text-transform",
  "text-decoration-line",
  "border-top-color",
  "border-bottom-color",
  "border-top-width",
  "border-bottom-width",
  "border-radius",
];

/** Container layout, ported only for the wrapper that arranges the chrome. */
export const LAYOUT_PROPERTIES = [
  "flex-direction",
  "align-items",
  "justify-content",
  "gap",
  "column-gap",
  "max-width",
];

/** Roles measured on both sides. `source` is relative to the chrome element. */
export const CHROME_ROLES = {
  /**
   * The wrapper that arranges the logo against the menu.
   *
   * Found by walking up from the logo to the first flex or grid ancestor,
   * rather than by selector: every site names this element differently, but
   * every site has one, and it is what decides whether the logo and navigation
   * sit side by side or stack.
   */
  headerLayout: { find: "layoutContainer", properties: LAYOUT_PROPERTIES },

  headerBackground: {
    source: null,
    properties: [
      "background-color",
      "background-image",
      "background-size",
      "background-position",
      "background-repeat",
      "border-bottom-color",
      "border-bottom-width",
    ],
  },
  // The contact/utility band above or below the logo row. Sites name this
  // differently, so the selector is overridable from config.
  headerBar: {
    source: ".top-bar, .header-bar, .utility-bar, #hd-bottom",
    properties: ["background-color", "color", "font-size", "font-family"],
  },
  navLink: { source: "nav > ul > li > a, nav ul li a", properties: PORTED_PROPERTIES },
  navSubLink: { source: "nav ul ul li a", properties: PORTED_PROPERTIES },
  // Width only: pinning the height as well distorts the logo whenever the
  // rendered aspect ratio differs even slightly from the source's.
  logo: { source: "img", properties: ["width"] },
  headerPhone: { source: ".pho, .phy, a[href^='tel:']", properties: PORTED_PROPERTIES },

  footerBackground: {
    source: null,
    properties: [
      "background-color",
      "background-image",
      "background-size",
      "background-position",
      "background-repeat",
      "color",
      "border-top-color",
    ],
  },
  footerHeading: { source: "h2, h3, .h2, .h3", properties: PORTED_PROPERTIES },
  footerLink: { source: "a", properties: PORTED_PROPERTIES },
  footerText: { source: "p", properties: PORTED_PROPERTIES },
};

/** Read one element's computed values for a role. */
export async function measureChromeStyles(page, { chrome, roles = CHROME_ROLES, roleSelectors = {} }) {
  // A site can point a role at its own markup without changing the toolkit.
  roles = Object.fromEntries(
    Object.entries(roles).map(([role, spec]) => [
      role,
      roleSelectors[role] ? { ...spec, source: roleSelectors[role], find: null } : spec,
    ])
  );

  return page.evaluate(
    ({ chrome, roles }) => {
      const out = {};

      const rootFor = (role) =>
        role.startsWith("footer") ? document.querySelector(chrome.footer) : document.querySelector(chrome.header);

      const isVisible = (el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0;
      };

      for (const [role, spec] of Object.entries(roles)) {
        const root = rootFor(role);
        if (!root) continue;

        let element = root;

        if (spec.find === "layoutContainer") {
          const logo = root.querySelector("img");
          const menu = root.querySelector("nav ul, nav, ul");
          let node = logo?.parentElement ?? null;
          element = null;

          while (node && node !== root.parentElement) {
            const display = getComputedStyle(node).display;
            // It must arrange the logo *against the menu*. A logo link is
            // frequently a flex container in its own right, and stopping there
            // measures the wrong element entirely.
            const arrangesBoth = !menu || node.contains(menu);
            if ((display === "flex" || display === "grid") && arrangesBoth) {
              element = node;
              break;
            }
            node = node.parentElement;
          }
          if (!element) continue;
        } else if (spec.source) {
          const candidates = [];
          for (const selector of spec.source.split(",").map((s) => s.trim())) {
            try {
              candidates.push(...root.querySelectorAll(selector));
            } catch {
              /* selector unsupported */
            }
          }
          // The largest visible match is the representative one: a header
          // usually contains several links, and the primary nav item is the
          // one that actually defines the look.
          element = candidates
            .filter(isVisible)
            .sort((a, b) => {
              const ra = a.getBoundingClientRect();
              const rb = b.getBoundingClientRect();
              return rb.width * rb.height - ra.width * ra.height;
            })[0];
        }

        if (!element) continue;

        const cs = getComputedStyle(element);
        const values = {};
        for (const property of spec.properties) values[property] = cs.getPropertyValue(property);
        out[role] = values;
      }

      return out;
    },
    { chrome, roles: serializeRoles(roles) }
  );
}

/**
 * `page.evaluate` cannot receive functions, so send plain data.
 *
 * Every field a role can carry has to be listed here — an omitted one arrives
 * as `undefined` in the page and the role silently measures the wrong element.
 */
function serializeRoles(roles) {
  return Object.fromEntries(
    Object.entries(roles).map(([role, spec]) => [
      role,
      { source: spec.source ?? null, find: spec.find ?? null, properties: spec.properties },
    ])
  );
}

/**
 * Values that carry no information.
 *
 * `color` is deliberately absent: black is the CSS initial value but also a
 * real design decision, and the template's own text is not black — dropping it
 * would silently leave the target's colour in place.
 */
const DEFAULTS = {
  "background-color": ["rgba(0, 0, 0, 0)", "transparent"],
  "background-image": ["none"],
  "background-size": ["auto"],
  "background-position": ["0% 0%"],
  "background-repeat": ["repeat"],
  // Arrangement properties are never filtered by their CSS initial value:
  // they exist to override whatever the target does, and the target's value is
  // frequently the non-initial one. `flex-direction: row` is exactly the case —
  // dropping it as a "default" leaves a stacked target header stacked.
  gap: ["normal"],
  "column-gap": ["normal"],
  "max-width": ["none"],
  "letter-spacing": ["normal"],
  "text-transform": ["none"],
  "text-decoration-line": ["none"],
  "border-bottom-width": ["0px"],
  "border-top-width": ["0px"],
  "border-radius": ["0px"],
  "font-style": ["normal"],
};

/** A border colour means nothing without a width to draw it. */
function hasBorderWidth(property, values) {
  const side = property.match(/^border-(top|bottom|left|right)-color$/)?.[1];
  if (!side) return true;
  const width = values[`border-${side}-width`];
  return Boolean(width) && parseFloat(width) > 0;
}

function isMeaningful(property, value, values = {}) {
  if (!value) return false;
  if ((DEFAULTS[property] ?? []).includes(value.trim())) return false;
  return hasBorderWidth(property, values);
}

/**
 * Point a ported `url()` at the rehosted copy.
 *
 * A computed `background-image` carries the absolute URL the mirror served it
 * from, which resolves to nothing once the migration is deployed. Anything with
 * no mapping is left alone rather than rewritten to a guess.
 */
export function rewriteUrls(value, assetMap) {
  return value.replace(/url\((["']?)([^"')]+)\1\)/g, (whole, quote, ref) => {
    const mapped = assetMap.get(ref) ?? assetMap.get(pathOf(ref));
    return mapped ? `url("${mapped}")` : whole;
  });
}

/** The path portion of a URL, so an absolute and a relative ref agree. */
export function pathOf(ref) {
  try {
    return new URL(ref).pathname.replace(/^\//, "");
  } catch {
    return ref.replace(/^\//, "");
  }
}

/** Every asset a measured style set references. */
export function assetsIn(measured) {
  const refs = new Set();
  for (const values of Object.values(measured)) {
    for (const [property, value] of Object.entries(values)) {
      if (property !== "background-image" || !value) continue;
      for (const m of value.matchAll(/url\((["']?)([^"')]+)\1\)/g)) refs.add(pathOf(m[2]));
    }
  }
  return [...refs];
}

/** Colours in the source palette become tokens; everything else stays literal. */
function tokenize(value, palette, maxDeltaE) {
  const parsed = parseColor(value);
  if (!parsed || !palette) return value;

  const hex = formatHex(parsed);
  const target = toOklch(hex);
  if (!target) return value;

  for (const [token, tokenHex] of Object.entries(palette)) {
    const candidate = toOklch(tokenHex);
    if (candidate && dE(target, candidate) <= maxDeltaE) {
      // Token first, literal as a fallback: the chrome then follows a branding
      // change, and still renders correctly if the variable is ever unset.
      return `var(${token}, ${hex})`;
    }
  }
  return hex;
}

/**
 * Emit the override stylesheet.
 *
 * Layout properties are not ported. The template arranges its chrome with its
 * own grid and container queries, and pasting the source's positioning on top
 * fights that rather than matching it — the visible identity of a header is its
 * colour, type and band backgrounds, which is what this carries across.
 */
export function emitChromeStyles(
  measured,
  { targetSelectors, palette = null, maxDeltaE = 0.02, assetMap = new Map() } = {}
) {
  const blocks = [];

  for (const [role, values] of Object.entries(measured)) {
    const selector = targetSelectors[role];
    if (!selector) continue;

    const declarations = Object.entries(values)
      .filter(([property, value]) => isMeaningful(property, value, values))
      .map(([property, value]) => {
        let ported = value;
        if (/color$/.test(property)) ported = tokenize(value, palette, maxDeltaE);
        else if (property === "background-image") ported = rewriteUrls(value, assetMap);
        return `    ${property}: ${ported};`;
      });

    // A pinned width needs an explicit auto height, or the element keeps
    // whatever intrinsic or inherited height the target gave it.
    if (role === "headerLayout" && declarations.length) {
      declarations.unshift("    display: flex;");
    }

    if (role === "logo" && values.width) {
      declarations.push("    height: auto;", "    max-width: 100%;");
    }

    if (declarations.length) {
      blocks.push(`  /* ${role} */\n  ${selector} {\n${declarations.join("\n")}\n  }`);
    }
  }

  if (!blocks.length) return null;

  return [
    "/* Header and footer styling ported from the source site.",
    "   Colours, type and band backgrounds only — the template keeps its own",
    "   layout and dropdown behaviour. */",
    "@layer source-bridge {",
    blocks.join("\n\n"),
    "}",
    "",
  ].join("\n");
}
