/**
 * Detect the layout patterns the generator is known to drop, and the smells it
 * is known to emit in their place.
 *
 * `pair-by-text.mjs` compares *typography* on elements that share text. It is
 * blind to everything structural, because a section that lost its parallax
 * background, its overlay header or its hover captions still says the same
 * words at the same font size. Every one of those survived `dev-verify` clean
 * on the Taylor Dental Care homepage and still had to be rebuilt by hand.
 *
 * The failures were not one-offs; they are properties of how the generator
 * works, so each has a signature worth checking on every site:
 *
 *   - Computed styles are read one node at a time, so a rule that only makes
 *     sense *between* siblings is lost. A header that overlays the hero
 *     (`position: absolute` + no background) becomes an opaque bar pushed above
 *     it, and alternating negative `margin-top`s that stagger a row of cards
 *     flatten out.
 *   - `background-attachment`, and a scrim drawn by a section's `::before`, are
 *     backgrounds of a *container*, which the emitter treats as a pass-through
 *     wrapper and collapses.
 *   - A hover reveal is two states of one element. Captured at rest it is an
 *     invisible paragraph; captured as pixels it becomes absolute offsets
 *     measured at one viewport, which is why service captions arrived with
 *     `top: 154.4px`.
 *   - Emitted class names are not namespaced against the theme's own CSS, which
 *     the mirror still ships. `fa-heading` is a real Font Awesome icon class,
 *     and the homepage rendered its glyph in front of "Featured Articles".
 *
 * Both sides run the same detector, so a pattern is only reported when the
 * source has it and the build does not. The built-only checks below have no
 * source counterpart — they are artefacts, and any hit is a defect.
 */

/** What each pattern is, and what to do when the build is missing it. */
export const PATTERN_META = {
  overlayHeader: {
    label: "Header overlays the hero",
    hint: "Give the header an `is-transparent` variant (absolute + transparent background, solid again once scrolled) and pass it only on the page whose hero sits behind it.",
  },
  barIndicators: {
    label: "Carousel indicators are bars, not dots",
    hint: "Emit the indicators as wide flat rules (Bootstrap's default is 30x3, half opacity until active), not circles.",
  },
  staggeredRow: {
    label: "Row of cards is staggered",
    hint: "Alternate cards carry a negative `margin-top`. Re-apply it per breakpoint with an `:nth-child()` rule.",
  },
  fixedBackground: {
    label: "Section has a fixed/parallax background",
    hint: "Keep `background-attachment: fixed` with the image on the section itself; the emitter drops it when it collapses the wrapper.",
  },
  splitMediaRow: {
    label: "Half-screen background-image column",
    hint: "The photo is a background on a column that must hold 50% of the row and stretch to the copy's height, not an `<img>` sized by its own aspect ratio.",
  },
  hoverCaption: {
    label: "Image caption is revealed on hover",
    hint: "Rebuild the reveal with transforms (title centred, translating up and recolouring on hover; body text at opacity 0 until hover). Never bake the captured offsets in as pixels.",
  },
  overlayScrim: {
    label: "Photo section has a gradient scrim",
    hint: "Re-add the `::before` gradient over the section's background photo, and keep the content above it.",
  },
  headingRule: {
    label: "Heading has a divider rule under it",
    hint: 'The heading\'s `::after` draws a box. Emit its `display`/`width`/`height`/`margin`, not just its colour and `content` — a bare `content: ""` renders nothing.',
  },
};

/** Built-only artefacts: a hit is a defect regardless of the source. */
export const SMELL_META = {
  horizontalOverflow: {
    label: "Page scrolls horizontally",
    hint: "Usually the `left: 180px; margin-left: -195px` full-bleed hack. A section in `main` is already full width — delete the offsets.",
  },
  negativeMarginBleed: {
    label: "Negative-margin full-bleed hack",
    hint: "Replace `left/right` + negative side margins with `width: 100%` and an inner `margin-inline: auto` container.",
  },
  fractionalOffsets: {
    label: "Caption positioned by measured pixels",
    hint: "Fractional `top`/`bottom` values are offsets measured at one viewport. Re-express the position with transforms so it survives other viewports.",
  },
  iconClassCollision: {
    label: "Emitted class collides with an icon font",
    hint: "The class matches a vendor icon rule that is still shipped in the mirrored CSS, so its glyph renders inside your element. Rename the class.",
  },
  emptySection: {
    label: "Section renders nothing",
    hint: "The emitter kept the wrapper's styling but gave its text no prop, so the section ships empty — three pages lost their `<h1>` this way. Add the prop and set it from the page front matter.",
  },
};

/**
 * Read the structural patterns off the page. Runs inside the browser.
 *
 * Each detector returns short, human-readable locators rather than element
 * handles: the two DOMs are different shapes, so the report has to be read by
 * a person, not diffed by index.
 */
export const DETECT_PATTERNS = () => {
  const where = (el) => {
    const id = el.id ? `#${el.id}` : "";
    const cls =
      typeof el.className === "string" && el.className.trim()
        ? `.${el.className.trim().split(/\s+/).slice(0, 3).join(".")}`
        : "";
    const text = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40);

    return `${el.tagName.toLowerCase()}${id}${cls}${text ? ` "${text}"` : ""}`;
  };

  const px = (v) => {
    const n = parseFloat(v);

    return Number.isFinite(n) ? n : 0;
  };
  const transparent = (v) =>
    !v || v === "transparent" || /rgba\([^)]*,\s*0(\.0+)?\)$/.test(v.replace(/\s+/g, ""));

  const all = [...document.querySelectorAll("body *")];
  const visible = all.filter((el) => {
    const r = el.getBoundingClientRect();

    return r.width > 0 && r.height > 0;
  });
  const docWidth = document.documentElement.clientWidth || 1;
  const found = {};
  const add = (id, el) => {
    (found[id] ||= []).push(where(el));
  };

  for (const el of visible) {
    const cs = getComputedStyle(el);
    const before = getComputedStyle(el, "::before");
    const rect = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();
    const hasBgImage = cs.backgroundImage && cs.backgroundImage !== "none";

    // A header taken out of flow with nothing painted behind it is sitting on
    // top of whatever section follows it.
    if (
      (tag === "header" || el.getAttribute("role") === "banner") &&
      (cs.position === "absolute" || cs.position === "fixed") &&
      transparent(cs.backgroundColor) &&
      !hasBgImage
    ) {
      add("overlayHeader", el);
    }

    // Bar-style carousel indicators: a run of identical wide, flat, clickable
    // siblings. Dots fail the aspect test, which is the whole point.
    const barHeight = px(cs.height);
    const barWidth = px(cs.width);

    if (
      cs.cursor === "pointer" &&
      barHeight > 0 &&
      barHeight <= 8 &&
      barWidth >= barHeight * 3 &&
      el.parentElement &&
      [...el.parentElement.children].filter((sib) => {
        const scs = getComputedStyle(sib);

        return Math.abs(px(scs.height) - barHeight) < 1 && Math.abs(px(scs.width) - barWidth) < 1;
      }).length >= 3
    ) {
      add("barIndicators", el.parentElement);
    }

    // Staggered row: siblings on one row where some are pulled upwards.
    //
    // The threshold is a design decision, not a rounding one. A -20px nudge on
    // a 60%-wide box is the emitter reproducing a measurement; the source's
    // real stagger lifts alternate cards by 45-60px. Anything shallower than a
    // line of text is noise.
    if (px(cs.marginTop) <= -24) {
      let row = el.parentElement;

      for (let up = 0; up < 3 && row && row.children.length < 3; up += 1) row = row.parentElement;
      if (row && row.children.length >= 3) add("staggeredRow", row);
    }

    if (hasBgImage && cs.backgroundAttachment.includes("fixed")) add("fixedBackground", el);

    // A photo column: a background image, no text of its own, holding about
    // half the row.
    if (
      hasBgImage &&
      !(el.textContent || "").trim() &&
      rect.height >= 250 &&
      rect.width / docWidth > 0.35 &&
      rect.width / docWidth < 0.65
    ) {
      add("splitMediaRow", el);
    }

    // A gradient scrim painted over a section's own photo.
    if (
      hasBgImage &&
      before.content !== "none" &&
      before.position === "absolute" &&
      /gradient/.test(before.backgroundImage || "")
    ) {
      add("overlayScrim", el);
    }
  }

  // A heading underlined by its own ::after. The box is what makes it visible,
  // and the box is exactly what the emitter used to drop.
  for (const h of document.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    const af = getComputedStyle(h, "::after");

    if (af.content === "none" || af.content === "normal") continue;
    const painted =
      (af.backgroundColor && af.backgroundColor !== "rgba(0, 0, 0, 0)") ||
      (af.borderTopWidth && parseFloat(af.borderTopWidth) > 0);

    if (!painted) continue;
    if (parseFloat(af.width) >= 20 && parseFloat(af.height) > 0) add("headingRule", h);
  }

  // Hover-revealed captions: a caption whose body copy is transparent at rest.
  for (const cap of document.querySelectorAll("figcaption, figure > div, figure > a")) {
    const hidden = [...cap.querySelectorAll("p, h2, h3, div")].some((child) => {
      const cs = getComputedStyle(child);

      return (
        parseFloat(cs.opacity) === 0 &&
        cs.position === "absolute" &&
        (child.textContent || "").trim().length > 0
      );
    });

    if (hidden) add("hoverCaption", cap.closest("figure") || cap);
  }

  for (const id of Object.keys(found)) found[id] = [...new Set(found[id])];
  return found;
};

/**
 * Read the built-only artefacts. Runs inside the browser, on the build.
 */
export const DETECT_SMELLS = () => {
  const where = (el) => {
    const id = el.id ? `#${el.id}` : "";
    const cls =
      typeof el.className === "string" && el.className.trim()
        ? `.${el.className.trim().split(/\s+/).slice(0, 3).join(".")}`
        : "";

    return `${el.tagName.toLowerCase()}${id}${cls}`;
  };

  // Icon fonts keep their glyphs in the Unicode private use area, so a
  // private-use `::before` on an element that is not itself an icon means a
  // vendor rule matched an emitted class name.
  const ICON_CLASS = /^(fa|fas|far|fab|fal|fad|glyphicon|icon|ion|material-icons)-/;
  const found = {};
  const add = (id, detail) => {
    (found[id] ||= []).push(detail);
  };
  const doc = document.documentElement;

  if (doc.scrollWidth - doc.clientWidth > 1) {
    add("horizontalOverflow", `${doc.scrollWidth}px content in a ${doc.clientWidth}px viewport`);
  }

  // Measured offsets have to be read off the *authored* rules: a computed style
  // resolves `top: 50%` to a fractional pixel too, so reading them here would
  // flag every correctly-centred caption on the page.
  const OFFSET_PROPS = ["top", "bottom", "left", "right"];
  const walkRules = (rules) => {
    for (const rule of rules) {
      if (rule.cssRules) {
        walkRules(rule.cssRules);
        continue;
      }
      if (!rule.style || !rule.selectorText) continue;

      for (const prop of OFFSET_PROPS) {
        const value = rule.style.getPropertyValue(prop).trim();

        if (/^-?\d+\.\d+px$/.test(value)) {
          add("fractionalOffsets", `${rule.selectorText} { ${prop}: ${value} }`);
        }
      }
    }
  };

  for (const sheet of document.styleSheets) {
    try {
      walkRules(sheet.cssRules);
    } catch {
      // Cross-origin sheet; nothing we emitted lives there.
    }
  }

  // A section that styles text it was never given a prop for.
  for (const el of document.querySelectorAll("main section, main article, main > div")) {
    if (el.children.length > 0 || (el.textContent || "").trim()) continue;
    const cs = getComputedStyle(el);
    const paints =
      cs.backgroundImage !== "none" ||
      (cs.backgroundColor && cs.backgroundColor !== "rgba(0, 0, 0, 0)");

    // A deliberate spacer says nothing about type. A section that sets type it
    // was never given the text for is the bug: `wpmig/section` shipped styled
    // as a 36px uppercase heading with no prop to put a heading in.
    const parent = el.parentElement ? getComputedStyle(el.parentElement) : null;
    const typesetsText = cs.textTransform !== "none" || (parent && cs.fontSize !== parent.fontSize);

    if (!paints && typesetsText && el.className) {
      add(
        "emptySection",
        `${where(el)} (styled ${cs.fontSize}/${cs.textTransform}, renders nothing)`
      );
    }
  }

  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);

    if (parseFloat(cs.marginLeft) <= -100 && cs.left !== "auto" && cs.position === "relative") {
      add("negativeMarginBleed", `${where(el)} (margin-left ${cs.marginLeft}, left ${cs.left})`);
    }

    const classes =
      typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean) : [];
    const iconish = classes.filter((c) => ICON_CLASS.test(c));

    if (iconish.length > 0) {
      const glyph = getComputedStyle(el, "::before").content.replace(/["']/g, "");

      if (glyph && glyph !== "none" && glyph.charCodeAt(0) >= 0xe000) {
        add("iconClassCollision", `${where(el)} — class "${iconish[0]}" renders a vendor glyph`);
      }
    }
  }

  for (const id of Object.keys(found)) found[id] = [...new Set(found[id])].slice(0, 12);
  return found;
};

/**
 * Turn one page's two readings into findings.
 *
 * A pattern present in the source and absent from the build is `missing`; one
 * present in both is `kept` and reported only in verbose mode, because a count
 * that dropped without reaching zero is still worth a look.
 */
export function comparePatterns(sourcePatterns, builtPatterns, smells) {
  const findings = [];

  for (const [id, meta] of Object.entries(PATTERN_META)) {
    const source = sourcePatterns[id] || [];
    const built = builtPatterns[id] || [];

    if (source.length === 0) continue;
    findings.push({
      kind: "pattern",
      id,
      label: meta.label,
      hint: meta.hint,
      status: built.length === 0 ? "missing" : built.length < source.length ? "partial" : "kept",
      sourceCount: source.length,
      builtCount: built.length,
      examples: source.slice(0, 4),
    });
  }

  for (const [id, meta] of Object.entries(SMELL_META)) {
    const hits = (smells || {})[id] || [];

    if (hits.length === 0) continue;
    findings.push({
      kind: "smell",
      id,
      label: meta.label,
      hint: meta.hint,
      status: "present",
      builtCount: hits.length,
      examples: hits.slice(0, 4),
    });
  }

  return findings;
}

/** Findings that mean the page does not match the source yet. */
export function actionableFindings(findings) {
  return findings.filter((f) => f.status === "missing" || f.status === "present");
}
