/**
 * Turn measured chrome roles into a custom-property layer the target's own
 * header and footer components consume.
 *
 * Why properties rather than rules: the target renders chrome from data with
 * markup it owns, and that markup is not the source's. Emitting selectors
 * would mean emitting selectors for a DOM that does not exist here — the
 * approach that works for a bespoke section, where the migrator writes the
 * markup too, and cannot work for chrome. A token layer inverts it: the
 * migrator states what the source looked like, and the component decides which
 * of its own parts each measurement applies to. Anything the source did not
 * have simply never gets a token, and the component keeps its own default.
 */

const NONE = new Set(["", "none", "normal", "auto", "0px", "rgba(0, 0, 0, 0)", "transparent"]);

/**
 * What disqualifies a *token*, as opposed to an input value.
 *
 * Narrower than NONE by one entry, and the difference matters: `0px` is a
 * measurement. A source whose call-to-action has square corners reports
 * `border-radius: 0px`, and dropping that leaves the component's own rounded
 * fallback in place — so the one site that deliberately has no radius is the
 * one site that gets the template's pill button. Zero is an answer; only
 * absence is not.
 */
const UNSET = new Set(["", "none", "normal", "auto", "rgba(0, 0, 0, 0)", "transparent", "null", "undefined"]);

/**
 * Round a pixel length, and leave every other unit exactly as measured.
 *
 * `parseFloat` happily reads `25%` as `25`, so appending "px" unconditionally
 * turns a quarter-width column into a 25-pixel one — a value that is both
 * wrong and plausible enough to survive review. Percentages, `em` and viewport
 * units all reach here from real computed styles (`max-width`, `width`), so
 * the unit has to come from the string rather than be assumed.
 */
const px = (v) => {
  const m = String(v ?? "").trim().match(/^(-?[\d.]+)([a-z%]*)$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n * 100) / 100;
  return `${rounded}${m[2] || (rounded === 0 ? "" : "px")}`;
};

/** A colour worth writing down: present, and not fully transparent. */
const color = (v) => {
  if (!v || NONE.has(v)) return null;
  const m = v.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const parts = m[1].split(",").map((s) => parseFloat(s));
    if (parts.length > 3 && parts[3] <= 0.02) return null;
  }
  return v;
};

const len = (v) => {
  if (!v || UNSET.has(v)) return null;
  return px(v) ?? v;
};

/** `1px solid #e8e8e8`, or null where the side carries no rule. */
const border = (styles, side) => {
  const w = parseFloat(styles[`border${side}Width`]);
  if (!Number.isFinite(w) || w <= 0) return null;
  const style = styles[`border${side}Style`];
  if (!style || style === "none") return null;
  const c = color(styles[`border${side}Color`]) ?? "currentColor";
  return `${px(styles[`border${side}Width`])} ${style} ${c}`;
};

/**
 * CSS keywords that name a *category* of face rather than a face, and so must
 * stay unquoted.
 */
const GENERIC_FAMILIES = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy",
  "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded",
  "math", "emoji", "fangsong", "inherit", "initial", "revert", "unset",
]);

/**
 * A font stack, carried through as the browser resolved it — the fonts
 * pipeline has already mirrored the faces, and rewriting the stack here would
 * be a second, disagreeing opinion about which family won.
 *
 * Family *names* are quoted, generic families are not. Quoting is what a font
 * name is supposed to have (it is a string, not a keyword), and leaving it off
 * makes `Roboto` look like a keyword whose case is wrong to every linter that
 * reads the output — eleven errors in a generated file that a project then has
 * to either fix by hand on every run or exclude from linting.
 */
const font = (v) => {
  if (!v || NONE.has(v)) return null;
  return String(v)
    .split(",")
    .map((part) => {
      const family = part.trim().replace(/^["']|["']$/g, "");
      if (!family) return null;
      return GENERIC_FAMILIES.has(family.toLowerCase()) ? family : `"${family}"`;
    })
    .filter(Boolean)
    .join(", ");
};

/**
 * The token map: role → the properties worth taking from it.
 *
 * Each entry is `[tokenName, reader]`. A reader returning null drops the token
 * entirely rather than emitting an empty value, so the component's own
 * fallback survives — which is the whole point of a layer that may be
 * measuring a source that has no such element.
 */
const TOKENS = {
  headerBand: [
    ["header-bg", (r) => color(r.styles.backgroundColor)],
    ["header-pad-top", (r) => len(r.styles.paddingTop)],
    ["header-pad-bottom", (r) => len(r.styles.paddingBottom)],
    /*
     * No `header-height`.
     *
     * A brand bar's height is decided by what is in it — the logo and the type
     * beside it — so it is a *result*, not a design decision, and pinning it
     * makes the bar disagree with its own contents. It is also the least
     * stable thing here: this site's header carries a third-party reviews
     * widget that loads over the network, so the same page measured twice
     * reported 116px and 136px, and the token layer churned on every run for a
     * value nothing consumed. The padding above and below is the part that was
     * actually authored, and that is what gets emitted.
     */
  ],
  headerInner: [
    ["container-max", (r) => len(r.styles.maxWidth)],
    ["container-pad", (r) => len(r.styles.paddingLeft)],
  ],
  headerRow: [
    ["header-row-pad-top", (r) => len(r.styles.paddingTop)],
    ["header-row-pad-bottom", (r) => len(r.styles.paddingBottom)],
  ],
  headerLogo: [
    ["header-logo-width", (r) => (r.box.w > 0 ? `${r.box.w}px` : null)],
    ["header-logo-pad-right", (r) => len(r.styles.paddingRight)],
  ],
  headerLogoBox: [
    ["header-logo-divider", (r) => border(r.styles, "Right")],
    ["header-logo-box-pad-right", (r) => len(r.styles.paddingRight)],
  ],
  headerAside: [
    ["header-aside-width", (r) => len(r.styles.maxWidth)],
    ["header-aside-align", (r) => r.styles.textAlign || null],
  ],
  headerAsideLabel: [
    ["header-label-color", (r) => color(r.styles.color)],
    ["header-label-size", (r) => len(r.styles.fontSize)],
    ["header-label-weight", (r) => r.styles.fontWeight || null],
    ["header-label-font", (r) => font(r.styles.fontFamily)],
    ["header-label-indent", (r) => len(r.styles.marginLeft)],
  ],
  headerAsidePhone: [
    ["header-phone-color", (r) => color(r.styles.color)],
    ["header-phone-size", (r) => len(r.styles.fontSize)],
    ["header-phone-weight", (r) => r.styles.fontWeight || null],
    ["header-phone-font", (r) => font(r.styles.fontFamily)],
  ],

  navBar: [
    ["nav-bg", (r) => color(r.styles.backgroundColor)],
    ["nav-border-top", (r) => border(r.styles, "Top")],
    ["nav-border-bottom", (r) => border(r.styles, "Bottom")],
    ["nav-height", (r) => (r.box.h > 0 ? `${r.box.h}px` : null)],
    ["nav-position", (r) => (r.styles.position === "sticky" || r.styles.position === "fixed" ? r.styles.position : null)],
  ],
  navLink: [
    ["nav-link-color", (r) => color(r.styles.color)],
    ["nav-link-size", (r) => len(r.styles.fontSize)],
    ["nav-link-weight", (r) => r.styles.fontWeight || null],
    ["nav-link-font", (r) => font(r.styles.fontFamily)],
    ["nav-link-transform", (r) => (r.styles.textTransform === "none" ? null : r.styles.textTransform)],
    ["nav-link-pad-x", (r) => len(r.styles.paddingLeft)],
    ["nav-link-pad-y", (r) => len(r.styles.paddingTop)],
  ],
  navCta: [
    ["nav-cta-bg", (r) => color(r.styles.backgroundColor)],
    ["nav-cta-color", (r) => color(r.styles.color)],
    ["nav-cta-size", (r) => len(r.styles.fontSize)],
    ["nav-cta-weight", (r) => r.styles.fontWeight || null],
    ["nav-cta-font", (r) => font(r.styles.fontFamily)],
    ["nav-cta-pad-x", (r) => len(r.styles.paddingLeft)],
    ["nav-cta-pad-y", (r) => len(r.styles.paddingTop)],
    ["nav-cta-radius", (r) => len(r.styles.borderTopLeftRadius)],
  ],
  navToggle: [["nav-toggle-color", (r) => color(r.styles.color)]],
  navPhone: [
    ["nav-phone-color", (r) => color(r.styles.color)],
    ["nav-phone-size", (r) => len(r.styles.fontSize)],
    ["nav-phone-weight", (r) => r.styles.fontWeight || null],
    ["nav-phone-font", (r) => font(r.styles.fontFamily)],
  ],

  dropdownPanel: [
    ["dropdown-bg", (r) => color(r.styles.backgroundColor)],
    ["dropdown-width", (r) => len(r.styles.width) ?? (r.box.w > 0 ? `${r.box.w}px` : null)],
    ["dropdown-min-width", (r) => len(r.styles.minWidth)],
    ["dropdown-shadow", (r) => (NONE.has(r.styles.boxShadow) ? null : r.styles.boxShadow)],
    ["dropdown-radius", (r) => len(r.styles.borderTopLeftRadius)],
    ["dropdown-offset", (r) => len(r.styles.marginTop)],
    ["dropdown-pad-y", (r) => len(r.styles.paddingTop)],
  ],
  dropdownItem: [
    ["dropdown-item-color", (r) => color(r.styles.color)],
    ["dropdown-item-size", (r) => len(r.styles.fontSize)],
    ["dropdown-item-weight", (r) => r.styles.fontWeight || null],
    ["dropdown-item-font", (r) => font(r.styles.fontFamily)],
    ["dropdown-item-pad-x", (r) => len(r.styles.paddingLeft)],
    ["dropdown-item-pad-y", (r) => len(r.styles.paddingTop)],
    ["dropdown-item-border", (r) => border(r.styles, "Bottom")],
  ],

  dropdownItemIcon: [
    ["dropdown-icon-color", (r) => color(r.styles.color)],
    ["dropdown-icon-size", (r) => len(r.styles.fontSize)],
    ["dropdown-icon-gap", (r) => len(r.styles.paddingRight)],
  ],

  footerBand: [
    ["footer-bg", (r) => color(r.styles.backgroundColor)],
    ["footer-color", (r) => color(r.styles.color)],
    ["footer-pad-block", (r) => len(r.styles.paddingTop)],
    ["footer-border-top", (r) => border(r.styles, "Top")],
  ],
  footerColumn: [["footer-column-font", (r) => font(r.styles.fontFamily)]],
  footerLogo: [["footer-logo-width", (r) => (r.box.w > 0 ? `${r.box.w}px` : null)]],
  footerHeading: [
    ["footer-heading-color", (r) => color(r.styles.color)],
    ["footer-heading-size", (r) => len(r.styles.fontSize)],
    ["footer-heading-weight", (r) => r.styles.fontWeight || null],
    ["footer-heading-font", (r) => font(r.styles.fontFamily)],
    ["footer-heading-transform", (r) => (r.styles.textTransform === "none" ? null : r.styles.textTransform)],
  ],
  footerRule: [
    ["footer-rule", (r) => border(r.styles, "Top")],
    // Split out as well as bundled: themes overwhelmingly reuse the rule's
    // colour as the column's link-hover colour, and a shorthand cannot be
    // taken apart in CSS.
    ["footer-rule-color", (r) => color(r.styles.borderTopColor)],
    ["footer-rule-margin-top", (r) => len(r.styles.marginTop)],
    ["footer-rule-margin-bottom", (r) => len(r.styles.marginBottom)],
  ],
  footerLink: [
    ["footer-link-color", (r) => color(r.styles.color)],
    ["footer-link-size", (r) => len(r.styles.fontSize)],
    ["footer-link-weight", (r) => r.styles.fontWeight || null],
    ["footer-link-font", (r) => font(r.styles.fontFamily)],
    ["footer-link-gap", (r) => len(r.styles.marginTop)],
  ],
  footerLinkIcon: [
    ["footer-icon-color", (r) => color(r.styles.color)],
    ["footer-icon-size", (r) => len(r.styles.fontSize)],
    ["footer-icon-gap", (r) => len(r.styles.paddingRight)],
  ],

  copyrightBand: [
    ["copyright-bg", (r) => color(r.styles.backgroundColor)],
    ["copyright-color", (r) => color(r.styles.color)],
    ["copyright-size", (r) => len(r.styles.fontSize)],
    ["copyright-weight", (r) => r.styles.fontWeight || null],
    ["copyright-font", (r) => font(r.styles.fontFamily)],
    ["copyright-pad-block", (r) => len(r.styles.paddingTop)],
    ["copyright-align", (r) => r.styles.textAlign || null],
  ],
};

/** Reduce one width's role measurements to a flat token → value map. */
export function tokensFor(measured) {
  const out = {};
  for (const [role, entries] of Object.entries(TOKENS)) {
    const record = measured?.[role];
    if (!record) continue;
    for (const [name, read] of entries) {
      let value = null;
      try { value = read(record); } catch { value = null; }
      if (value != null && !UNSET.has(String(value))) out[`--chrome-${name}`] = String(value);
    }
  }
  return out;
}

/**
 * Emit mobile-base plus `min-width` overrides.
 *
 * Only tokens that actually *change* at a wider width are re-declared. The
 * alternative — restating the full set per breakpoint — reads as though every
 * value were deliberate at every width, and buries the handful that differ.
 * A token present at the base and absent higher up is re-emitted with the
 * wider width's own value rather than left to inherit, because inheriting is
 * how a mobile value leaks into the desktop bar.
 */
export function emitChromeCss(byWidth, { banner = "" } = {}) {
  const widths = Object.keys(byWidth).map(Number).sort((a, b) => a - b);
  if (!widths.length) return "";

  const perWidth = new Map(widths.map((w) => [w, tokensFor(byWidth[w])]));
  const base = perWidth.get(widths[0]);

  const block = (decls, indent) =>
    Object.entries(decls)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${indent}  ${k}: ${v};`)
      .join("\n");

  const parts = [];
  // A leading blank line: the Writer stamps its own provenance comment as line
  // one, and two comments with nothing between them is a lint error in most
  // configurations.
  if (banner) parts.push("", banner.trim(), "");
  parts.push(":root {", block(base, ""), "}");

  let previous = base;
  for (const width of widths.slice(1)) {
    const here = perWidth.get(width);
    const changed = {};
    for (const [k, v] of Object.entries(here)) {
      if (previous[k] !== v) changed[k] = v;
    }
    // A token the narrower width declared and this one does not still has to
    // be answered for: left alone it keeps the narrow value at every width
    // above, which is the mobile-leak failure in a different costume.
    for (const k of Object.keys(previous)) {
      if (!(k in here)) changed[k] = "initial";
    }
    if (Object.keys(changed).length) {
      parts.push("", `@media (min-width: ${width}px) {`, "  :root {", block(changed, "  "), "  }", "}");
    }
    previous = { ...previous, ...here };
  }

  return `${parts.join("\n")}\n`;
}
