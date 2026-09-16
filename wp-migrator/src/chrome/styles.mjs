/**
 * Measure the *rendered* appearance of the site chrome.
 *
 * `extract.mjs` reads the header and footer as content — menus, links, phone
 * numbers. That is what makes them editable, and it is deliberately all it
 * does. Nothing then reads how the source actually *presented* that content,
 * so the migrated chrome renders the right words in the target's own design:
 * the one part of every page that is visible on every page is also the one
 * part no stage of the pipeline ever compared against the original.
 *
 * This module closes that half. It measures the chrome the same way
 * `capture/section.mjs` measures a section — computed styles off a real render,
 * at each breakpoint — but against a fixed set of *roles* rather than a
 * discovered tree. Chrome is the one region of a site whose parts are known in
 * advance (there is always a bar, a logo, menu links, maybe a dropdown panel
 * and a call-to-action), so naming the roles is what lets a template that
 * renders its own markup still be styled from the measurements.
 */

/**
 * Chrome roles, and how to find each in a source document.
 *
 * Several candidate selectors per role, tried in order: the first that matches
 * a *visible* element wins. Themes disagree about markup but agree about the
 * furniture, which is why the roles are stable even though the selectors are
 * a list of guesses.
 */
export const ROLES = {
  // ---- header ----------------------------------------------------------
  headerBand: ['.header', 'header .header-top', 'header > .top-bar', '#masthead .top', 'header'],
  headerInner: ['.header .container', 'header .container', '.header > div'],
  /*
   * The row inside the header that holds the logo, separately from the band
   * around it. Themes put breathing room on both — the band's padding sets the
   * header off from the page, the row's insets its contents — and reading only
   * the band's makes the logo, and any rule drawn beside it, run the full
   * height of the header and butt against the menu bar below.
   */
  headerRow: ['.header .header-block', '.header-block', '.header .row', 'header .row'],
  headerLogo: ['.header-block__logo img', 'header .logo img', '.site-logo img', 'header img'],
  // The logo's own box, separately from the image: themes rule the brand off
  // from whatever sits beside it with a border on this element, and a border
  // read from the `<img>` finds nothing.
  headerLogoBox: ['.header-block__logo', 'header .logo', '.site-logo', '.custom-logo-link'],
  headerAside: ['.header-block__right', 'header .header-right', 'header .contact'],
  headerAsideLabel: ['.header-block__right span', 'header .header-right span'],
  headerAsidePhone: ['.header-block__right p a', 'header .header-right a[href^="tel:"]', 'header a[href^="tel:"]'],

  // ---- nav bar ---------------------------------------------------------
  navBar: ['nav.navbar', 'header nav', '.main-navigation', '#site-navigation'],
  navInner: ['nav.navbar .container', 'header nav .container'],
  navList: ['nav.navbar ul.navbar-nav', 'nav ul.menu', 'nav > ul', 'header nav ul'],
  navLink: ['nav.navbar ul.navbar-nav > li > a', 'nav ul.menu > li > a', 'header nav > ul > li > a'],
  /*
   * The call-to-action, which is routinely two elements rather than one: a
   * wide desktop version and a compact one for the collapsed bar, each hidden
   * at the other's width. Measuring only the first selector reports the
   * desktop button's 16px type as the mobile bar's, and the button then
   * overruns the number beside it.
   *
   * `painted` is what keeps `.navbar-brand` in this list honest — in Bootstrap
   * that class is normally the logo link, and a logo has no background.
   */
  navCta: [
    'nav.navbar a.navbar-text',
    { selector: 'nav.navbar a.navbar-brand', painted: true },
    'nav .btn',
    'header nav a.button',
  ],
  navToggle: ['.navbar-toggler', '.menu-toggle', 'button.hamburger'],
  // The number restated in the menu bar for narrow screens. Sized quite
  // differently from the brand tier's — that one is the page's loudest
  // element, this one has to share a row with a button and a toggle.
  navPhone: ['nav.navbar a.mobile-phone-number', 'nav .mobile-phone', 'nav a[href^="tel:"]'],

  // ---- dropdown --------------------------------------------------------
  dropdownPanel: ['.dropdown-menu', 'nav ul.menu ul.sub-menu', 'nav li > ul'],
  dropdownItem: ['.dropdown-menu .dropdown-item', 'nav ul.sub-menu > li > a', 'nav li > ul > li > a'],
  dropdownItemIcon: ['.dropdown-menu .dropdown-item i', '.dropdown-menu .dropdown-item svg', 'nav ul.sub-menu > li > a i'],

  // ---- footer ----------------------------------------------------------
  footerBand: ['footer .footer', 'footer', '#colophon'],
  footerInner: ['footer .footer .container', 'footer .container'],
  footerRow: ['footer .footer .row', 'footer .row'],
  footerColumn: ['footer .footer-block', 'footer .widget', 'footer .col'],
  footerLogo: ['footer .footer-block--logo img', 'footer .footer-logo img', 'footer img'],
  footerHeading: ['footer .footer-block h3', 'footer .widget-title', 'footer h3', 'footer h4'],
  footerRule: ['footer .footer-block hr', 'footer hr'],
  footerLink: ['footer .footer-block a', 'footer .widget a', 'footer a'],
  footerLinkIcon: ['footer .footer-block a .fas', 'footer .footer-block a .fab', 'footer .widget a i'],
  footerSocialImage: ['footer .footer-block--logo img[src*="icon"]', 'footer .social img'],

  // ---- copyright strip -------------------------------------------------
  copyrightBand: ['.copyright', 'footer .site-info', '.site-footer-bottom'],
  copyrightInner: ['.copyright .container', 'footer .site-info .container'],
};

/**
 * Properties worth carrying across. Deliberately narrower than the section
 * allowlist: a template renders chrome markup it already owns, so structural
 * properties it decides for itself (grid templates, flex-basis) would be read
 * and then ignored. What transfers is the *look* — colour, type, spacing,
 * rules — plus enough box geometry for the comparison stage to score it.
 */
const PROPS = [
  "display", "flexDirection", "justifyContent", "alignItems", "gap",
  "backgroundColor", "color",
  "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing",
  "textAlign", "textTransform", "textDecorationLine",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "marginTop", "marginRight", "marginBottom", "marginLeft",
  "borderTopWidth", "borderTopStyle", "borderTopColor",
  "borderRightWidth", "borderRightStyle", "borderRightColor",
  "borderBottomWidth", "borderBottomStyle", "borderBottomColor",
  "borderLeftWidth", "borderLeftStyle", "borderLeftColor",
  "borderTopLeftRadius", "boxShadow", "opacity",
  "maxWidth", "minWidth", "width", "height", "position",
];

/**
 * Read every role in one page evaluation.
 *
 * Dropdown panels are `display:none` until opened, and a hidden element has no
 * box and no resolved colours — measured at rest, every dropdown in the site
 * reports zero and the migrated menu gets the template's own panel styling.
 * They are forced visible for the read and restored afterwards, so the
 * surrounding measurements are taken against an undisturbed layout.
 */
function READ_ROLES({ roles, props }) {
  const out = {};
  const restore = [];

  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const force = (el) => {
    // Walk up: a panel is hidden by its own `display:none` on some themes and
    // by an ancestor's collapsed wrapper on others.
    for (let node = el, i = 0; node && i < 4; node = node.parentElement, i++) {
      const cs = getComputedStyle(node);
      if (cs.display !== "none" && cs.visibility !== "hidden") continue;
      restore.push([node, node.style.cssText]);
      node.style.setProperty("display", "block", "important");
      node.style.setProperty("visibility", "visible", "important");
      node.style.setProperty("opacity", "1", "important");
    }
  };

  const read = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const styles = {};
    for (const p of props) styles[p] = cs[p];
    const before = getComputedStyle(el, "::before");
    const after = getComputedStyle(el, "::after");
    return {
      box: {
        x: Math.round(r.x), y: Math.round(r.y + window.scrollY),
        w: Math.round(r.width), h: Math.round(r.height),
      },
      styles,
      /*
       * Does this element render any text of its own?
       *
       * Every element resolves a colour and a font stack whether or not it
       * draws with them, so a `<ul>`, an `<hr>` or a link wrapping only a logo
       * all report a full set of inherited type values that paint nothing.
       * Comparing those across two different DOMs produces a page of findings
       * about invisible properties and buries the ones that show.
       */
      ownsText: [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()),
      // A caret, a chevron, a divider rule — chrome leans on generated content
      // more than page sections do, and a menu that loses its caret reads as a
      // plain link rather than as something that opens.
      before: before.content !== "none" && before.content !== "normal"
        ? { content: before.content, color: before.color, fontSize: before.fontSize, fontFamily: before.fontFamily }
        : null,
      after: after.content !== "none" && after.content !== "normal"
        ? { content: after.content, color: after.color, fontSize: after.fontSize, fontFamily: after.fontFamily }
        : null,
    };
  };

  /** Does this element paint a background or a border of its own? */
  const painted = (el) => {
    const cs = getComputedStyle(el);
    if (cs.backgroundImage !== "none") return true;
    const m = (cs.backgroundColor || "").match(/rgba?\(([^)]+)\)/);
    if (m) {
      const parts = m[1].split(",").map((n) => parseFloat(n));
      if ((parts.length > 3 ? parts[3] : 1) > 0.02) return true;
    }
    return ["Top", "Right", "Bottom", "Left"].some((s) => parseFloat(cs[`border${s}Width`]) > 0);
  };

  for (const [role, selectors] of Object.entries(roles)) {
    let chosen = null;
    let hidden = false;
    for (const entry of selectors) {
      const sel = typeof entry === "string" ? entry : entry.selector;
      const needsPaint = typeof entry === "object" && entry.painted;
      let el;
      try { el = document.querySelector(sel); } catch { continue; }
      if (!el) continue;
      if (needsPaint && !painted(el)) continue;
      if (visible(el)) { chosen = el; hidden = false; break; }
      // Keep the first hidden match as a fallback: a dropdown panel is always
      // hidden, and so is every element behind a collapsed mobile menu.
      if (!chosen) { chosen = el; hidden = true; }
    }
    if (!chosen) { out[role] = null; continue; }
    if (hidden) force(chosen);
    out[role] = { ...read(chosen), forced: hidden };
  }

  for (const [node, css] of restore) node.style.cssText = css;
  return out;
}

/** Measure every chrome role at one viewport width. */
export async function measureChrome(page, { roles = ROLES } = {}) {
  return page.evaluate(READ_ROLES, { roles, props: PROPS });
}

/**
 * Measure the chrome across breakpoints.
 *
 * `goto` is supplied by the caller and re-navigates before each width. Reusing
 * one loaded page and only resizing looks equivalent and is not: a collapsed
 * navbar that was measured at 1440 keeps its desktop layout classes after a
 * resize on themes that assign them once at load, so the mobile read comes
 * back describing the desktop bar.
 */
export async function measureChromeAcross(page, { widths, goto, roles = ROLES }) {
  const byWidth = {};
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await goto(page, width);
    byWidth[width] = await measureChrome(page, { roles });
  }
  return byWidth;
}
