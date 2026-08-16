import { gotoStable } from "../browser/load.mjs";

/**
 * Carousel chrome — the prev/next arrows and the pager dots.
 *
 * `mig behaviors` reads the source slider's *option object* (`autoplaySpeed`,
 * `arrows`, `dots`, `slidesToShow`) and carries those settings across. It does
 * not carry the controls' appearance, because that never lived in the options:
 * slick, owl and swiper all ship a default arrow and a default dot, the source
 * restyles them in its own stylesheet, and the template's carousel ships its
 * own defaults in turn. The port swaps one library's furniture for another's
 * and nothing in the pipeline notices.
 *
 * Every other pass here is blind to it by construction:
 *
 *   - the geometry and surface passes measure *sections*, and a 96x56 arrow
 *     inside a 650px section moves nothing they measure;
 *   - the height passes see no change at all when the arrows are absolutely
 *     positioned over the slides, which is the usual arrangement;
 *   - the heading pass pairs on text, and controls have none.
 *
 * What actually shipped on the page that prompted this: the source's 96x56
 * white pill with a 1px #292929 border and a 30px radius came out as the
 * template's bare 32px grey chevron, and the source's 12px black-outlined dots
 * (filled #2B8435 when active) came out as solid brand-coloured circles that
 * scale up on select. Both are pure decoration, both are on every slide, and
 * neither is visible to anything that measures boxes at section scale.
 *
 * Controls are found by role rather than by library class name. Sources use
 * whatever their slider shipped (`.slick-arrow`, `.owl-prev`, `.swiper-button-
 * next`, a bare `#prev`), and the migrated side uses the template's own names,
 * so matching on either side's vocabulary would only ever find one of them.
 * Accessible name and the prev/next word in the class or id are what both sides
 * genuinely share.
 */

/**
 * A control's paint, normalized so the two libraries' markup is comparable.
 *
 * Size is included because it is half the fault — a control can be the right
 * colour and still be a third of the size. Position is not: the source's arrow
 * may be absolutely positioned over the slide where the migrated one sits below
 * it, which the surface and height passes already cover at section scale, and
 * reporting it here would bury the paint differences that only this pass sees.
 */
const DESCRIBE = ({ arrowPattern, dotMin, dotMax, roots }) => {
  const rect = (el) => el.getBoundingClientRect();

  const scopes = roots.flatMap((sel) => {
    try {
      return [...document.querySelectorAll(sel)];
    } catch {
      return [];
    }
  });
  const searchIn = scopes.length ? scopes : [document.body];
  const within = (el) => searchIn.some((scope) => scope.contains(el));

  const visible = (el) => {
    const cs = getComputedStyle(el);

    if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return false;
    const r = rect(el);

    return r.width > 0 && r.height > 0;
  };

  /**
   * Corner radius as a shape, not as the string the stylesheet happened to use.
   *
   * The two sides express the same circle differently and always will: a source
   * of this vintage writes `border-radius: 50%`, and a utility-first template
   * writes a `--radius-full` of `9999px`. Both compute to a circle on a 12px
   * dot; comparing the strings reports every pager on every migrated site as a
   * difference, which is how a check stops being read.
   */
  const radius = (el, cs) => {
    const box = rect(el);
    const shortest = Math.min(box.width, box.height);
    const corners = [
      cs.borderTopLeftRadius,
      cs.borderTopRightRadius,
      cs.borderBottomRightRadius,
      cs.borderBottomLeftRadius,
    ].map((value) => {
      const px = String(value).includes("%")
        ? (parseFloat(value) / 100) * shortest
        : parseFloat(value) || 0;

      return Math.round(px);
    });

    // "full" rather than "circle": the same test is what makes a square dot a
    // circle and a 96x56 arrow a pill, and calling the pill a circle in the
    // report reads as a bug in the check.
    if (corners.every((corner) => corner >= shortest / 2 - 1)) return "full";
    return corners.every((corner) => corner === corners[0])
      ? `${corners[0]}px`
      : corners.map((corner) => `${corner}px`).join(" ");
  };

  const paint = (el) => {
    const cs = getComputedStyle(el);
    const width = Math.round(parseFloat(cs.borderTopWidth) || 0);

    return {
      size: `${Math.round(rect(el).width)}x${Math.round(rect(el).height)}`,
      background: cs.backgroundColor,
      border: width === 0 ? "none" : `${width}px ${cs.borderTopStyle} ${cs.borderTopColor}`,
      radius: radius(el, cs),
      // A glyph delivered as an <img>/<svg> child, a background-image, or a
      // pseudo-element `content` are all the same thing to a reader; reduce
      // each to whether a mark is present so an icon-font arrow and an SVG one
      // are not reported as a difference in themselves.
      glyph:
        el.querySelector("img, svg") !== null ||
        cs.backgroundImage !== "none" ||
        (getComputedStyle(el, "::before").content || "none") !== "none"
          ? "present"
          : "none",
    };
  };

  const name = (el) =>
    `${el.getAttribute("aria-label") || ""} ${el.id || ""} ${el.className?.baseVal ?? el.className ?? ""}`;

  // Arrows: anything clickable whose accessible name, id or class says which
  // direction it goes. The size ceiling keeps a whole slide out when a source
  // wires the click handler onto the slide itself.
  const arrows = [...document.querySelectorAll("button, a, [role='button'], div, span")]
    .filter(within)
    .filter((el) => arrowPattern.test(name(el)))
    .filter(visible)
    .filter((el) => rect(el).width <= 200 && rect(el).height <= 200)
    .filter((el, _i, all) => !all.some((other) => other !== el && el.contains(other)));

  const direction = (el) => (/prev|left|back/i.test(name(el)) ? "prev" : "next");

  // Dots: a run of three or more small square elements with no text.
  // Deliberately structural — slick nests `li > button > span`, embla renders a
  // flat row of `button`s, owl uses `span`s, and no class name is common to any
  // two of them.
  const candidates = [...document.querySelectorAll("button, li, span, a, div")].filter((el) => {
    if (!within(el) || !visible(el)) return false;
    const r = rect(el);

    if (r.width < dotMin || r.width > dotMax || r.height < dotMin || r.height > dotMax) return false;
    if (Math.abs(r.width - r.height) > 4) return false;
    return (el.textContent || "").trim().length === 0;
  });

  // Group by the nearest ancestor that holds the whole run, not by the direct
  // parent. Slick gives every dot its own `<li>` wrapper, so keying on the
  // parent splits one five-dot pager into five groups of one and finds nothing;
  // the shared `<ul>` is the container both libraries actually have.
  const groups = new Map();

  for (const el of candidates) {
    let container = el.parentElement;

    while (
      container &&
      candidates.filter((other) => other !== container && container.contains(other)).length < 3
    ) {
      container = container.parentElement;
    }
    if (!container) continue;
    if (!groups.has(container)) groups.set(container, []);
    groups.get(container).push(el);
  }

  /**
   * Is this run part of the same widget as an arrow?
   *
   * Without this the check is far too eager. When the migrated page hides its
   * indicators — a `slideNumbers` prop swapping them for "3 / 5" is the common
   * case — the largest remaining run of small square elements on the page is
   * some unrelated furniture: a row of service icons, a set of star ratings, a
   * footer's social links. Reporting those as the pager buries the one thing
   * worth saying, which is that the pager is gone.
   *
   * A pager and its arrows are always siblings inside the slider's own control
   * strip (`.slick-controls`, `.controls-wrapper`, `.owl-nav`'s parent), so a
   * common ancestor below the page-level landmarks is a reliable test of "same
   * widget". When there are no arrows at all there is nothing to anchor to and
   * the largest run in scope is the best available answer.
   */
  const sameWidgetAsArrow = (container) => {
    if (arrows.length === 0) return true;
    return arrows.some((arrow) => {
      for (let node = container; node; node = node.parentElement) {
        if (node === document.body || node.tagName === "MAIN" || node.tagName === "HTML")
          return false;
        if (node.contains(arrow)) return true;
      }
      return false;
    });
  };

  const dotRun = [...groups.entries()]
    .filter(([container]) => sameWidgetAsArrow(container))
    .map(([, run]) => run)
    // Innermost wins: slick's `<li>`, its `<button>` and the `<span>` inside it
    // all qualify on size, and it is the innermost one that carries the paint —
    // the wrappers are transparent and unrounded, which would read as a total
    // mismatch against a template that styles the button itself.
    .map((run) => run.filter((el) => !run.some((other) => other !== el && el.contains(other))))
    .filter((run) => run.length >= 3)
    .sort((a, b) => b.length - a.length)[0];

  // The active marker is not reliably on the element that carries the paint.
  // Slick puts `.slick-active` on the `<li>` and the visible dot is the `<span>`
  // two levels below it; embla sets `data-selected` on the button itself.
  // Reading only the element and its parent finds slick's idle dot nowhere and
  // reports the active fill as the idle one.
  const selected = (el) => {
    for (let node = el, depth = 0; node && depth < 4; node = node.parentElement, depth++) {
      if (node.getAttribute?.("aria-selected") === "true") return true;
      if (node.getAttribute?.("data-selected") === "true") return true;
      if (/active|current|selected/i.test(node.className?.baseVal ?? node.className ?? ""))
        return true;
    }
    return false;
  };

  return {
    arrows: arrows.map((el) => ({ role: direction(el), ...paint(el) })),
    dots: dotRun
      ? {
          count: dotRun.length,
          idle: paint(dotRun.find((el) => !selected(el)) ?? dotRun[0]),
          active: paint(dotRun.find((el) => selected(el)) ?? dotRun[0]),
        }
      : null,
  };
};

export async function readControls(page, url, { dotMin = 6, dotMax = 30, roots = ["main"] } = {}) {
  const state = await gotoStable(page, url, {
    primeLazyLoad: true,
    reveal: true,
    freezeMotion: true,
  });

  if (!state.ok) return { ok: false, reason: state.reason };

  const found = await page.evaluate(
    ({ describeSrc, dotMin, dotMax, roots }) => {
      const describe = eval(`(${describeSrc})`);

      return describe({ arrowPattern: /prev|next/i, dotMin, dotMax, roots });
    },
    { describeSrc: DESCRIBE.toString(), dotMin, dotMax, roots }
  );

  return { ok: true, ...found };
}

/** The paint properties compared, in report order. */
const PAINT_KEYS = ["size", "background", "border", "radius", "glyph"];

/**
 * Diff the control chrome of two pages.
 *
 * Arrows pair by direction, dots by state. A page with no carousel on either
 * side reports nothing rather than a match, so the line only appears when there
 * was something to check.
 */
export function compareControls(source, target) {
  const rows = [];

  const diff = (label, a, b) => {
    const differs = PAINT_KEYS.filter((key) => a[key] !== b[key]).map((key) => ({
      key,
      source: a[key],
      target: b[key],
    }));

    if (differs.length > 0) rows.push({ label, differs });
  };

  for (const role of ["prev", "next"]) {
    const a = source.arrows?.find((arrow) => arrow.role === role);
    const b = target.arrows?.find((arrow) => arrow.role === role);

    if (a && b) diff(`${role} arrow`, a, b);
    else if (a && !b) rows.push({ label: `${role} arrow`, missing: "target", differs: [] });
    else if (!a && b) rows.push({ label: `${role} arrow`, missing: "source", differs: [] });
  }

  if (source.dots && target.dots) {
    if (source.dots.count !== target.dots.count) {
      rows.push({
        label: "pager",
        differs: [
          { key: "count", source: String(source.dots.count), target: String(target.dots.count) },
        ],
      });
    }
    diff("pager dot", source.dots.idle, target.dots.idle);
    diff("pager dot (active)", source.dots.active, target.dots.active);
  } else if (source.dots && !target.dots) {
    rows.push({ label: "pager", missing: "target", differs: [] });
  } else if (!source.dots && target.dots) {
    rows.push({ label: "pager", missing: "source", differs: [] });
  }

  return rows;
}

/** Whether either side had a carousel at all — the caller stays silent if not. */
export function hasControls(...sides) {
  return sides.some((side) => (side?.arrows?.length ?? 0) > 0 || side?.dots);
}
