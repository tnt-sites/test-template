import { gotoStable } from "../browser/load.mjs";

/**
 * Per-section *paint* checks for a page mapped onto template components.
 *
 * `sections.mjs` compares heights, which catches a section that came out the
 * wrong size. This pass catches the faults that leave the size alone.
 *
 * Two real ones, both from the same root cause — `mig content` reads a source
 * section's rule for the props it knows (`backgroundColor`, `backgroundImage`,
 * `reverse`, …) and drops everything else on that rule:
 *
 *   1. `.block:nth-of-type(even) { background-color: #f2f2f2; border: 1px solid
 *      #000 }` ported as `backgroundColor: surface`. The tint arrived, the
 *      outline did not. A 1px border changes a 560px section to 562px, which is
 *      inside any sane height tolerance, so the height pass calls it a match
 *      and the page is visibly wrong on every service page.
 *
 *   2. The tint itself landing on the nearest ramp token rather than the source
 *      hex — `--gray-1` (#eaeaea) standing in for #f2f2f2. Nothing about the
 *      geometry moves.
 *
 * The same blindness covers `box-shadow`, `border-radius` and `outline`: all
 * decoration, none of it load-bearing for layout, all of it dropped silently.
 *
 * Sections are paired by *document order*, not by id. The height pass can
 * demand ids because it is aimed at bespoke ports that keep the source's ids;
 * the sections this pass is for are the ordinary mapped ones, and they usually
 * have no id at all — the source's `div.why` and `.page-divider > .block` carry
 * a class and nothing else. Requiring an id here would silently skip the whole
 * body of every interior page, which is exactly what it did before this pass
 * existed.
 */

/**
 * Resolve a page's sections the way `mig scan` does, so both sides of the
 * comparison see the same set the content stage worked from.
 *
 * Deliberately a copy of `segmentPage`'s element-rule resolution rather than a
 * call into it: `segmentPage` also normalizes role sequences and needs the
 * mirror's uid stamps, neither of which exists on the migrated side.
 *
 * Per selector, outermost wins (an outer `<section>` and an inner one are one
 * section, not two). Across selectors, innermost wins (an element that contains
 * another matched element is a layout wrapper — `div#page` holds `.why` and the
 * blocks, and it is those, not the wrapper, that became components).
 */
const COLLECT = ({ selectors, roots, minHeight }) => {
  const searchRoots = roots.flatMap((sel) => {
    try {
      return [...document.querySelectorAll(sel)];
    } catch {
      return [];
    }
  });
  const scopes = searchRoots.length ? searchRoots : [document.body];

  const claimed = [];
  for (const selector of selectors) {
    const matched = scopes.flatMap((scope) => {
      try {
        return [...scope.querySelectorAll(selector)];
      } catch {
        return [];
      }
    });
    const outermost = matched.filter(
      (el) => !matched.some((other) => other !== el && other.contains(el))
    );
    for (const el of outermost) if (!claimed.includes(el)) claimed.push(el);
  }

  const visible = claimed.filter((el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    if (el.getBoundingClientRect().height < minHeight) return false;

    // An element with neither text nor media is not a section, whatever its
    // height. A source page's in-page anchors are `<p><a name="what"></a></p>`
    // sitting as direct children of the flow container, so a section rule
    // matches them; at 120px of line-height and margin they clear any height
    // floor. They never became a component, so counting them shifts every
    // later section by one and reports the whole page as wrong.
    const hasText = (el.textContent || "").trim().length > 0;
    const hasMedia = el.querySelector("img, svg, picture, video, iframe, canvas") !== null;
    return hasText || hasMedia;
  });

  const kept = visible.filter(
    (el) => !visible.some((other) => other !== el && el.contains(other))
  );

  kept.sort((a, b) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
  );

  return kept;
};

/**
 * What a section paints, normalized so the two sides are comparable.
 *
 * `backgroundColor` is resolved up the ancestor chain rather than read
 * directly. A source section is routinely transparent over a white `<body>`
 * while its migrated counterpart sets `background-color: #fff` explicitly —
 * identical to look at, and reporting it would train the reader to ignore this
 * table. Resolving both to the colour actually painted removes that whole class
 * of false positive while still catching a genuine tint change.
 *
 * A background *image* is reduced to present/absent. The two sides serve it
 * from different paths by design, so the url never matches and only its
 * presence is meaningful. "Absent" has to be tested layer by layer: the
 * template's `.bg-layers` composes an image slot and a gradient slot into one
 * property, so a section with neither still computes to the string
 * `"none, none"` — which is not `"none"`, and reported as an added image on
 * every single section.
 */
const DESCRIBE = ({ els }) => {
  const opaque = (color) => {
    const parts = String(color).match(/[\d.]+/g);
    if (!parts) return false;
    return parts.length < 4 || Number(parts[3]) !== 0;
  };

  const paintedBackground = (el) => {
    for (let node = el; node; node = node.parentElement) {
      const color = getComputedStyle(node).backgroundColor;
      if (opaque(color)) return color;
    }
    return "rgb(255, 255, 255)";
  };

  const layered = (value) =>
    String(value)
      .split(/,(?![^(]*\))/)
      .every((layer) => layer.trim() === "none")
      ? "none"
      : "image";

  const edge = (cs, side) => {
    const width = Math.round(parseFloat(cs[`border${side}Width`]) || 0);
    if (width === 0) return "none";
    return `${width}px ${cs[`border${side}Style`]} ${cs[`border${side}Color`]}`;
  };

  return els.map((el, index) => {
    const cs = getComputedStyle(el);
    const sides = ["Top", "Right", "Bottom", "Left"].map((side) => edge(cs, side));
    const radii = [
      cs.borderTopLeftRadius,
      cs.borderTopRightRadius,
      cs.borderBottomRightRadius,
      cs.borderBottomLeftRadius,
    ];

    return {
      index,
      label:
        (el.id && `#${el.id}`) ||
        `${el.tagName.toLowerCase()}${[...el.classList]
          .slice(0, 2)
          .map((c) => `.${c}`)
          .join("")}`,
      background: paintedBackground(el),
      backgroundImage: layered(cs.backgroundImage),
      // One string per box: a dropped border is almost always all four sides,
      // and diffing the joined form keeps the report to one line.
      border: sides.every((side) => side === sides[0]) ? sides[0] : sides.join(" / "),
      radius: radii.every((r) => r === radii[0]) ? radii[0] : radii.join(" "),
      shadow: cs.boxShadow === "none" ? "none" : cs.boxShadow,
      height: Math.round(el.getBoundingClientRect().height),
    };
  });
};

export async function readSurfaces(page, url, { selectors, roots = ["main"], minHeight = 40 } = {}) {
  const state = await gotoStable(page, url, {
    primeLazyLoad: true,
    reveal: true,
    freezeMotion: true,
  });
  if (!state.ok) return { ok: false, reason: state.reason };

  const rows = await page.evaluate(
    ({ selectors, roots, minHeight, collectSrc, describeSrc }) => {
      const collect = eval(`(${collectSrc})`);
      const describe = eval(`(${describeSrc})`);
      return describe({ els: collect({ selectors, roots, minHeight }) });
    },
    {
      selectors,
      roots,
      minHeight,
      collectSrc: COLLECT.toString(),
      describeSrc: DESCRIBE.toString(),
    }
  );

  return { ok: true, rows };
}

/** The paint properties compared, in report order. */
const PAINT_KEYS = ["background", "backgroundImage", "border", "radius", "shadow"];

/**
 * Diff two ordered section lists.
 *
 * Height rides along with the paint properties. `sections.mjs` already compares
 * heights, but only for sections that carry an id, and the ordinary mapped
 * sections do not: the source's `div.why` came out 509px against the source's
 * 204 — a generic heading and a vertical list where the source has a 15px
 * uppercase kicker over three centred columns — and no pass saw it, because the
 * div has a class and no id. Positional pairing covers exactly that gap.
 *
 * Pairing is positional, so a count mismatch makes every row after the first
 * difference meaningless. It is reported as its own status and the paired rows
 * are still emitted — when one section was split in two, the rows before the
 * split are still worth reading, and the count line says where to stop trusting
 * them.
 */
export function compareSurfaces(source, target, { tolerancePx = 8 } = {}) {
  const rows = [];
  const paired = Math.min(source.length, target.length);

  for (let i = 0; i < paired; i++) {
    const a = source[i];
    const b = target[i];
    const differs = PAINT_KEYS.filter((key) => a[key] !== b[key]).map((key) => ({
      key,
      source: a[key],
      target: b[key],
    }));

    const delta = b.height - a.height;
    if (Math.abs(delta) > tolerancePx) {
      differs.push({
        key: "height",
        source: `${a.height}px`,
        target: `${b.height}px (${delta > 0 ? "+" : ""}${delta})`,
      });
    }

    rows.push({
      index: i,
      label: a.label,
      targetLabel: b.label,
      status: differs.length === 0 ? "match" : "differs",
      differs,
    });
  }

  for (let i = paired; i < source.length; i++) {
    rows.push({ index: i, label: source[i].label, status: "unpaired-source", differs: [] });
  }
  for (let i = paired; i < target.length; i++) {
    rows.push({ index: i, label: target[i].label, status: "unpaired-target", differs: [] });
  }

  return rows;
}
