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
/**
 * What counts as a heading, for the roles that look for one.
 *
 * Same reasoning as the extractor's: a page builder's heading widget picks
 * whatever tag the author left in a dropdown, and for a footer column that is
 * routinely a `<p>`.
 */
const HEADING_SEL =
  "h1,h2,h3,h4,h5,h6,.elementor-heading-title,.wp-block-heading,.widget-title,.widgettitle";

export const ROLES = {
  // ---- header ----------------------------------------------------------
  headerBand: ['.header', 'header .header-top', 'header > .top-bar', '#masthead .top', 'header'],
  /*
   * The thin strip above the menu — a phone number, an address, an opening
   * time — painted in the brand colour across the full width.
   *
   * `paintedBand` rather than a list of class names because a page builder
   * gives it none: the colour sits on a generated `<div class="e-con-full
   * elementor-element-2ef32a2f">` inside a transparent `<header>`, so a
   * selector reads the wrapper and reports the strip as having no background
   * at all. What identifies it is that it is the thing painting the width of
   * the header, and that is what is looked for.
   */
  headerTopBar: [
    '.header-top', 'header > .top-bar', '.top-bar', '#masthead .top',
    { selector: 'header', paintedBand: true },
  ],
  headerTopBarText: [
    '.header-top a', 'header > .top-bar a', '.top-bar a',
    'header a[href^="tel:"]',
  ],
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
  /*
   * The bar the menu sits in, as opposed to the menu itself.
   *
   * `navBar` above finds the `<nav>`, which on a page builder is only as wide
   * and as tall as its list of links — 46px here against the 86px bar drawn
   * around it. The height that has to be reproduced is the bar's, because
   * that is what sets the logo away from the top of the page, so the bar is
   * found by climbing out of the menu to the widest thing still wrapping it.
   */
  navBand: [
    { selector: 'header nav', bandOf: true },
    { selector: 'nav.navbar', bandOf: true },
    { selector: 'nav', bandOf: true },
  ],
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
  // The collapsed menu's button. `[class*="menu-toggle"]` last, because a page
  // builder names it for itself (`elementor-menu-toggle`) and a bare
  // `.menu-toggle` selector walks straight past it.
  navToggle: ['.navbar-toggler', '.menu-toggle', 'button.hamburger', '[class*="menu-toggle"]'],
  // The number restated in the menu bar for narrow screens. Sized quite
  // differently from the brand tier's — that one is the page's loudest
  // element, this one has to share a row with a button and a toggle.
  navPhone: ['nav.navbar a.mobile-phone-number', 'nav .mobile-phone', 'nav a[href^="tel:"]'],

  // ---- dropdown --------------------------------------------------------
  dropdownPanel: ['.dropdown-menu', 'nav ul.menu ul.sub-menu', 'nav li > ul'],
  dropdownItem: ['.dropdown-menu .dropdown-item', 'nav ul.sub-menu > li > a', 'nav li > ul > li > a'],
  dropdownItemIcon: ['.dropdown-menu .dropdown-item i', '.dropdown-menu .dropdown-item svg', 'nav ul.sub-menu > li > a i'],

  // ---- footer ----------------------------------------------------------
  /*
   * The band the footer's columns are drawn in.
   *
   * Not `<footer>` itself, which on a page builder is a transparent stack of
   * several bands — a promotional one, a testimonial one, the columns, the
   * copyright — each painting its own background. Measured as the footer, the
   * colour comes back as `transparent` and the type as whatever the document
   * inherits, and the migrated footer keeps the template's palette while
   * reporting that it measured the source's.
   *
   * `linkBand` picks the one that is actually the footer: the painted
   * full-width band holding the most ordinary page links. The promotional band
   * above it is painted and full-width too, but it holds a single button.
   */
  footerBand: [
    'footer .footer',
    { selector: 'footer', linkBand: true },
    { selector: '#colophon', linkBand: true },
    'footer',
  ],
  footerInner: ['footer .footer .container', 'footer .container'],
  footerRow: ['footer .footer .row', 'footer .row'],
  footerColumn: ['footer .footer-block', 'footer .widget', 'footer .col'],
  /*
   * Scoped to the band, all of them.
   *
   * `footer img` reads whichever image the footer happens to open with — here
   * a review badge in the testimonial band — and reports it as the brand logo.
   * `footer a` reads the promotional band's button and reports its type as the
   * footer's link type. Both are the same mistake: the footer is several
   * regions and only one of them is the footer.
   */
  footerLogo: [
    { selector: 'img', within: 'footerBand' },
    'footer .footer-block--logo img',
    'footer .footer-logo img',
  ],
  footerHeading: [
    { selector: HEADING_SEL, within: 'footerBand' },
    'footer .footer-block h3',
    'footer .widget-title',
  ],
  footerRule: ['footer .footer-block hr', 'footer hr'],
  footerLink: [
    { selector: 'a[href]:not([class*="social"])', within: 'footerBand', hasText: true },
    'footer .footer-block a',
    'footer .widget a',
  ],
  footerLinkIcon: ['footer .footer-block a .fas', 'footer .footer-block a .fab', 'footer .widget a i'],
  footerSocialImage: ['footer .footer-block--logo img[src*="icon"]', 'footer .social img'],
  // The social row's own badge — a white disc behind a coloured glyph here,
  // which is a design rather than the target's flat monochrome default.
  footerSocial: [
    { selector: '[class*="social-icon"] a[href], [class*="socials"] a[href]', within: 'footerBand' },
    'footer .social a',
  ],

  /*
   * The map-and-form band, which is invisible to every other pass.
   *
   * Its two halves are third-party iframes that a mirrored snapshot cannot
   * load, so the band reads as empty everywhere except in its own geometry:
   * the colour it paints, the split between the columns, and the type above
   * the form. Those are exactly what a rebuild needs, since the content is
   * two URLs.
   */
  footerFormBand: [{ selector: 'footer', embedBand: true }],
  /*
   * The panel the form sits in, found by climbing out of the iframe to the
   * nearest thing that paints. The band itself is transparent — the colour is
   * on the two columns inside it — so measuring the band reports a blue band
   * as having no colour at all.
   */
  footerFormPanel: [
    { selector: 'iframe:not([src*="map"])', within: 'footerFormBand', closestPainted: true },
    { selector: 'iframe', within: 'footerFormBand', closestPainted: true },
  ],
  /*
   * The card the form is mounted on, as distinct from the column it sits in.
   *
   * A form embed is transparent — it draws inputs and nothing behind them — so
   * on a coloured band its own grey placeholder text is set against the band's
   * blue and becomes unreadable. Themes solve this with a near-white backing
   * exactly the width of the frame, and that backing is the difference between
   * a legible form and a blue rectangle with ghosts in it.
   *
   * `paintedWrapper` is `closestPainted` inverted: it wants the painted
   * ancestor that hugs the frame, and reports nothing when the first one it
   * meets is wider, because a wider one is the column and the form has no card.
   */
  footerFormFrame: [
    { selector: 'iframe:not([src*="map"])', within: 'footerFormBand', paintedWrapper: true },
    { selector: 'iframe', within: 'footerFormBand', paintedWrapper: true },
  ],
  footerFormMap: [{ selector: 'iframe', within: 'footerFormBand' }],
  footerFormTitle: [{ selector: HEADING_SEL, within: 'footerFormBand', pick: 'largest' }],
  footerFormEyebrow: [{ selector: HEADING_SEL, within: 'footerFormBand', pick: 'smallest' }],

  // ---- copyright strip -------------------------------------------------
  /*
   * Found by what it says, because a page builder gives it nothing else: the
   * strip is one more generic container, and on this site it is the brand
   * blue with dark text — the inverse of the band above it, and nothing a
   * template would guess.
   */
  copyrightBand: [
    '.copyright',
    'footer .site-info',
    '.site-footer-bottom',
    { selector: 'footer', copyrightBand: true },
  ],
  copyrightInner: ['.copyright .container', 'footer .site-info .container'],
  /*
   * The line itself, rather than the strip around it.
   *
   * The strip is a container: it inherits the document's colour and its own
   * `text-align: start`, while the notice inside it is centred and white. Read
   * from the strip, a centred white line migrates as a left-aligned dark one.
   */
  copyrightText: [
    { selector: 'p,span,div', within: 'copyrightBand', hasText: true },
  ],
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

  const ownsText = (el) =>
    [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());

  /**
   * The colour this element's text is actually painted in.
   *
   * `getComputedStyle(el).color` is the element's own resolved colour, which
   * is what you see only when the element owns the text. Themes routinely
   * wrap the label — an `<a>` around a `<span>`, an icon list around its item
   * text — and the wrapper keeps the theme's link colour while the span
   * overrides it. Reading the wrapper then reports a colour that appears
   * nowhere on the page: this site's top bar measured as pink for a phone
   * number rendered in white, and the token was unusable.
   */
  const paintedColor = (el) => {
    const own = getComputedStyle(el);
    if (ownsText(el)) return own.color;
    for (const node of el.querySelectorAll("*")) {
      if (!ownsText(node)) continue;
      const cs = getComputedStyle(node);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      return cs.color;
    }
    return own.color;
  };

  /**
   * The element inside `el` that paints the band's background.
   *
   * Descends only through full-width wrappers, so it finds the strip and not
   * a button sitting in it: a child narrower than the band is something *on*
   * the band rather than the band itself.
   */
  const paintedBand = (el) => {
    let best = painted(el) ? el : null;
    let node = el;
    for (let i = 0; i < 6 && node; i++) {
      const width = node.getBoundingClientRect().width;
      const next = [...node.children].find(
        (child) => child.getBoundingClientRect().width >= width * 0.85
      );
      if (!next) break;
      if (!best && painted(next)) best = next;
      node = next;
    }
    return best;
  };

  /**
   * The full-width bar wrapping `el`.
   *
   * Climbs to the outermost ancestor still spanning the viewport, stopping at
   * the landmark: past `<header>` there is only the document, and the document
   * is not a bar.
   */
  const bandOf = (el) => {
    let best = null;
    for (let node = el; node && !/^(HEADER|FOOTER|MAIN|BODY|HTML)$/.test(node.tagName); node = node.parentElement) {
      if (node.getBoundingClientRect().width >= window.innerWidth * 0.9) best = node;
    }
    return best ?? el;
  };

  const ORDINARY_LINK = (a) => {
    const href = a.getAttribute("href") || "";
    return href && !/^(tel:|mailto:|sms:|#|javascript:)/i.test(href);
  };

  /**
   * The full-width painted band inside `root` holding the most page links.
   *
   * A footer built by a page builder is several stacked bands, each painting
   * its own background, and only one of them is the footer in the sense that
   * matters — the one with the columns of links. The others are a promotional
   * strip and a testimonial strip, which are full-width and painted too but
   * carry one link between them, so counting links separates them cleanly.
   *
   * Ties go to the deeper element, because an outer wrapper necessarily holds
   * at least as many links as the band inside it and is not the thing painting
   * the colour.
   */
  const linkBand = (root) => {
    if (!root) return null;
    let best = null;
    let most = 1;
    for (const el of root.querySelectorAll("*")) {
      if (!painted(el)) continue;
      if (el.getBoundingClientRect().width < window.innerWidth * 0.9) continue;
      const links = [...el.querySelectorAll("a[href]")].filter(ORDINARY_LINK).length;
      if (links > most || (links === most && best && best.contains(el))) {
        most = links;
        best = el;
      }
    }
    return best;
  };

  /** The full-width band inside `root` that holds an iframe. */
  const embedBand = (root) => {
    if (!root) return null;
    const frame = [...root.querySelectorAll("iframe[src]")].find(visible);
    if (!frame) return null;
    const wide = root.getBoundingClientRect().width * 0.9;
    let band = frame;
    for (let node = frame; node && node !== root; node = node.parentElement) {
      if (node.getBoundingClientRect().width >= wide) band = node;
    }
    return band === frame ? null : band;
  };

  const COPYRIGHT_RE =
    /(?:\u00a9|\(c\)|@)\s*(?:19|20)\d{2}|copyright\b|all rights reserved/i;

  /** The painted full-width strip inside `root` whose text is a copyright. */
  const copyrightBand = (root) => {
    if (!root) return null;
    let best = null;
    for (const el of root.querySelectorAll("*")) {
      if (!painted(el)) continue;
      if (el.getBoundingClientRect().width < window.innerWidth * 0.9) continue;
      const text = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (!text || text.length > 300 || !COPYRIGHT_RE.test(text)) continue;
      if (!best || text.length < (best.textContent || "").replace(/\s+/g, " ").trim().length) best = el;
    }
    return best;
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
      // The width the box was measured against, so a reader can express a
      // proportion rather than a pixel count that is only true at one size.
      viewport: window.innerWidth,
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
      ownsText: ownsText(el),
      textColor: paintedColor(el),
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

  /*
   * Roles are resolved in declaration order so that one can be scoped to
   * another: `within: "footerBand"` searches inside whatever `footerBand`
   * settled on, which is how the footer's heading and link roles avoid
   * measuring the promotional band stacked above the columns.
   */
  const picked = {};

  for (const [role, selectors] of Object.entries(roles)) {
    let chosen = null;
    let hidden = false;
    for (const entry of selectors) {
      const opts = typeof entry === "object" ? entry : {};
      const sel = typeof entry === "string" ? entry : entry.selector;
      const scope = opts.within ? picked[opts.within] : document;
      if (!scope) continue;
      let el;
      try {
        /*
         * `hasText` picks the first match that actually says something.
         *
         * A footer's first anchor is very often the logo, which wraps an image
         * and no text at all. Measured as "the footer link" it reports the
         * theme's unstyled link colour — a colour that appears nowhere on the
         * page — as the colour of every link in the footer.
         */
        if (opts.hasText) {
          const candidates = [...scope.querySelectorAll(sel)].filter(
            (c) => (c.textContent || "").trim() && visible(c)
          );
          /*
           * Prefer the element that owns the words over one that merely
           * contains them. A copyright line is a `<p>` inside three nested
           * wrappers, and every one of those wrappers "has text" — but they
           * carry the document's alignment and colour while the `<p>` carries
           * the design. Falls back to the outermost match for the markup where
           * nothing owns text directly.
           */
          el =
            candidates.find((c) =>
              [...c.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
            ) ?? candidates[0] ?? null;
        } else if (opts.pick) {
          /*
           * Which of several matches to measure, by rendered size. A band that
           * stacks a small line over a large one gives both the same tag, so
           * the tag cannot say which is the title — the type can.
           */
          const sized = [...scope.querySelectorAll(sel)]
            .filter(visible)
            .map((c) => [c, parseFloat(getComputedStyle(c).fontSize) || 0])
            .sort((a, b) => b[1] - a[1]);
          el = (opts.pick === "largest" ? sized[0] : sized.at(-1))?.[0] ?? null;
        } else {
          el = scope.querySelector(sel);
        }
      } catch { continue; }
      if (!el) continue;
      if (opts.paintedBand) el = paintedBand(el);
      if (el && opts.linkBand) el = linkBand(el);
      if (el && opts.copyrightBand) el = copyrightBand(el);
      if (el && opts.embedBand) el = embedBand(el);
      if (el && opts.paintedWrapper) {
        const own = el.getBoundingClientRect().width;
        let node = el.parentElement;
        while (node && !painted(node)) node = node.parentElement;
        // Wider than the frame means we walked past the card into the column.
        el = node && node.getBoundingClientRect().width <= own + 1 ? node : null;
      }
      if (el && opts.closestPainted) {
        /*
         * The panel the element sits in — not the wrapper hugging it.
         *
         * A form widget paints its own card the exact width of the frame
         * inside it, so the nearest painted ancestor is that card and the
         * column around it goes unmeasured: the band comes back off-white
         * with no padding when it is blue with fifty pixels of it. Requiring
         * the ancestor to be wider than what it wraps is what separates a
         * panel from a backing.
         */
        const own = el.getBoundingClientRect().width;
        let node = el.parentElement;
        while (node && !(painted(node) && node.getBoundingClientRect().width > own)) {
          node = node.parentElement;
        }
        el = node;
      }
      if (el && opts.bandOf) el = bandOf(el);
      if (!el) continue;
      if (opts.painted && !painted(el)) continue;
      if (visible(el)) { chosen = el; hidden = false; break; }
      // Keep the first hidden match as a fallback: a dropdown panel is always
      // hidden, and so is every element behind a collapsed mobile menu.
      if (!chosen) { chosen = el; hidden = true; }
    }
    if (!chosen) { out[role] = null; continue; }
    picked[role] = chosen;
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
