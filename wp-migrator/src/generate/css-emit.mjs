/**
 * Computed-style snapshots → scoped component CSS.
 *
 * The captured styles are raw getComputedStyle output at each breakpoint.
 * Emitting all of it would reproduce the browser's own defaults as authored
 * CSS, so every declaration must earn its place:
 *
 *   - drop values equal to the UA default for the tag,
 *   - drop inherited values equal to the parent's,
 *   - never emit `width` (a computed width is a *used* value — instead flex
 *     children get a snapped percentage basis, media gets width:100%),
 *   - grid track lists get converted back to repeat()/fr form,
 *   - the mobile capture is the base; wider breakpoints emit only their diff.
 *
 * Colors that became props are emitted as var(--x) references.
 */

import { formatHex, formatRgb, parse } from "culori";
import { INHERITED } from "../capture/allowlist.mjs";

const SNAP_PERCENTS = [20, 25, 33.33, 40, 50, 60, 66.67, 75, 80, 100];

const cssName = (camel) => camel.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

function roundPx(value) {
  return value.replace(/(-?\d+\.\d+)px/g, (m, n) => {
    const r = Math.round(parseFloat(n) * 10) / 10;
    return `${Number.isInteger(r) ? r.toFixed(0) : r}px`;
  });
}

function normColor(value) {
  if (!/^(rgb|hsl|#)/.test(value)) return value;
  const c = parse(value);
  if (!c) return value;
  const alpha = c.alpha ?? 1;
  if (alpha >= 0.999) return formatHex(c);
  return formatRgb({ ...c, alpha: Math.round(alpha * 100) / 100 });
}

export function normalizeValue(prop, value, origin) {
  if (value == null) return value;
  let v = String(value);
  if (origin) v = v.split(origin).join("");
  if (/color/i.test(prop)) return normColor(v);
  v = roundPx(v);
  // Colors can be embedded in shorthand-ish values (boxShadow, backgroundImage gradients).
  v = v.replace(/rgba?\([^)]+\)/g, (m) => normColor(m));
  return v;
}

/**
 * The tallest band we will accept as *authored*.
 *
 * Above this a measurement is far more likely to be an artefact — a container
 * measured with its accordions open, or a slice carrying its parent's geometry
 * — than a designer asking for a band taller than eight screens.
 */
const MAX_AUTHORED_BAND_PX = 2400;

function isNone(v) {
  return v === "none" || v === "normal" || v === "auto" || v === "" || v == null;
}

function collectEmittable(tree) {
  const list = [];
  const walk = (node) => {
    if (node.skip) return;
    list.push(node);
    if (node.array) {
      // A flattened array's items were measured inside one narrow layout
      // column; tag the template with the real grid share so declsFor can
      // override the column-derived basis it would otherwise inherit.
      if (node.flattenLayout && node.children[0]) {
        node.children[0].__flattenBasis = node.flattenLayout.basisPct;
      }
      walk(node.children[0]); // template item only
      return;
    }
    for (const c of node.children || []) walk(c);
  };
  walk(tree);
  return list;
}

/** Which declarations does this node earn at one breakpoint? */
function declsFor(node, bp, ctx) {
  const rec = ctx.styles[bp]?.[node.n];
  if (!rec) return null;
  const s = rec.styles;
  const parentRec = rec.parent != null ? ctx.styles[bp]?.[rec.parent] : null;
  const dflt = ctx.defaults[node.tag] || {};
  const out = {};

  if (!rec.visible) {
    const visibleSomewhere = ctx.breakpoints.some((b) => ctx.styles[b]?.[node.n]?.visible);
    return visibleSomewhere ? { display: "none" } : null;
  }

  const positioned = s.position !== "static";

  for (const [prop, raw] of Object.entries(s)) {
    if (raw == null) continue;
    let value = raw;

    switch (prop) {
      case "position":
        if (value === "static") continue;
        break;
      case "top":
      case "right":
      case "bottom":
      case "left":
        if (!positioned || value === "auto") continue;
        // A relatively-positioned box with a zero offset renders identically
        // to one with no offset at all (relative positioning only ever
        // *shifts* from the normal flow position) — 0px here is boilerplate
        // from a builder's reset, not authored intent, and every wrapper
        // in a widget tree tends to carry it.
        if (s.position === "relative" && parseFloat(value) === 0) continue;
        break;
      case "zIndex":
        if (!positioned || value === "auto") continue;
        break;
      case "flexGrow":
      case "flexShrink":
      case "flexBasis":
      case "alignSelf":
      case "order": {
        const inFlex = parentRec?.styles?.display?.includes("flex");
        if (!inFlex) continue;
        if (prop === "flexBasis") continue; // handled by basis recovery below
        if (value === (dflt[prop] ?? { flexGrow: "0", flexShrink: "1", alignSelf: "auto", order: "0" }[prop])) continue;
        break;
      }
      case "flexDirection":
      case "flexWrap":
      case "alignItems":
      case "alignContent":
      case "justifyContent":
      case "rowGap":
      case "columnGap":
        if (!s.display?.includes("flex") && !s.display?.includes("grid")) continue;
        if (prop === "flexDirection" && value === "row") continue;
        if (prop === "flexWrap" && value === "nowrap") continue;
        if ((prop === "alignItems" || prop === "alignContent") && value === "normal") continue;
        if (prop === "justifyContent" && value === "normal") continue;
        if ((prop === "rowGap" || prop === "columnGap") && value === "normal") continue;
        break;
      case "gridTemplateColumns": {
        if (!s.display?.includes("grid") || value === "none") continue;
        value = gridTracks(value);
        break;
      }
      case "transitionProperty":
      case "transitionDuration":
      case "transitionTimingFunction":
        continue; // only emitted (as a shorthand) when a hover rule exists
      case "cursor":
        continue; // UA behavior; never design
      case "backgroundImage": {
        if (isNone(value)) continue;
        const bgi = ctx.backgroundImageProp;
        if (bgi && bgi.nodeN === node.n && bgi.where === "base") {
          const url = (String(value).match(/url\(["']?([^"')]+)["']?\)/) || [])[1] || "";
          // Only the breakpoint actually showing the prop's image defers to
          // the variable; a breakpoint with its own artwork keeps the literal
          // URL, so the media-query diff emits the swap instead of erasing it.
          if (!bgi.url || url === bgi.url) value = `var(${bgi.varName}, none)`;
        }
        break;
      }
      case "borderTopColor":
      case "borderTopStyle":
        // A border's color/style is invisible — and not worth authoring —
        // unless some side actually has width. Builders commonly set a
        // border-color as a reset on every wrapper regardless of width.
        if (!["Top", "Right", "Bottom", "Left"].some((side) => parseFloat(s[`border${side}Width`]) > 0)) continue;
        break;
      case "maxWidth":
        if (value === "none") continue;
        break;
      case "minHeight": {
        if (value === "0px" || value === "auto") continue;
        // A copied `min-height` describes the node as it was measured, and two
        // things here make that measurement stop describing the node:
        // `disclose.mjs` opens every accordion before capture (it must, or a
        // closed panel measures as empty), and `splitByAnchors` then slices the
        // container it belongs to into separate components — each inheriting
        // the whole container's geometry. On this site that floored a 226px
        // block at 5547px and left a page two-thirds empty space.
        //
        // So keep it only while it is proportionate to what the node holds. An
        // authored band is somewhat taller than its content; one many times
        // taller is a stale number, and dropping it costs at most a band the
        // target's own padding will restore.
        const px = parseFloat(value);
        const kids = (node.children || [])
          .filter((c) => !c.skip)
          .map((c) => ctx.styles[bp]?.[c.n])
          .filter((r) => r?.visible && r.box?.h > 0);
        if (px > 0) {
          // With children, "proportionate" is measured against what they
          // occupy. Without them there is nothing to be proportionate to — and
          // a slice that lost its children to `splitByAnchors` is exactly the
          // case that produced a five-figure floor on an empty box — so fall
          // back to the node's own rendered height, then to a flat ceiling.
          const contentH = kids.length
            ? Math.max(...kids.map((r) => r.box.y + r.box.h)) - Math.min(...kids.map((r) => r.box.y))
            : (ctx.styles[bp]?.[node.n]?.box?.h ?? 0);
          if (px > Math.max(600, contentH * 2)) continue;
        }
        break;
      }
      default:
        break;
    }

    value = normalizeValue(prop, value, ctx.origin);

    // A node rendered through a SHARED component cannot rely on the two
    // shortcuts below. Both mean "the target will arrive at this value on its
    // own" — but the shared component injects its own typography and box
    // metrics (`size-md` sets a font-size, `.button` sets padding), so a value
    // omitted because it merely matched the parent or the tag default gets
    // replaced by the component's instead of inherited. That is why buttons
    // came out with the template's text size and no spacing.
    const sharedComponent = node.kind === "button";
    const FORCE_ON_SHARED = new Set([
      "fontSize", "fontWeight", "lineHeight", "letterSpacing", "fontFamily", "textTransform",
      "marginTop", "marginRight", "marginBottom", "marginLeft",
      "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    ]);

    // Headings are the same problem without a shared component to blame. The
    // starter restyles every `h1`-`h6` (`:where(:root) h2` sets a font-size and
    // `font-weight: bold`), so "matches the UA default" and "matches the
    // parent" both stop meaning "the target will arrive here on its own".
    //
    // The WordPress theme sized its interior `h2` at 24px — which is exactly
    // the UA default — and left it at `font-weight: 400`, inherited from the
    // section around it. Both were therefore dropped as redundant, and 96
    // headings across this site rendered at the starter's 46px bold instead.
    // The properties the target theme opinionates have to be stated outright.
    const FORCE_ON_HEADING = new Set([
      "fontSize", "fontWeight", "lineHeight", "fontFamily", "letterSpacing", "textTransform",
    ]);
    // Body copy is the third instance of the same trap, and the one that
    // reaches a visitor as unreadable text rather than merely wrong text. The
    // starter styles `p`/`li` with its own `--color-text`, so a `color` dropped
    // because the node inherited it from its parent gets *replaced* by the
    // starter's rather than inherited: on a brand-blue financing band whose
    // wrapper is correctly white, every paragraph rendered near-black on blue.
    // A colour is only safely omitted here when nothing in the target will
    // reassert one, and for `p`/`li` something always does.
    const FORCE_ON_TEXT = new Set(["color"]);
    const textNode = ["text", "richtext", "list"].includes(node.kind);

    const forced =
      (sharedComponent && FORCE_ON_SHARED.has(prop)) ||
      (node.kind === "heading" && FORCE_ON_HEADING.has(prop)) ||
      (textNode && FORCE_ON_TEXT.has(prop));

    const defaultValue = normalizeValue(prop, dflt[prop], ctx.origin);
    if (!forced && defaultValue != null && value === defaultValue) continue;
    if (!forced && INHERITED.has(prop) && parentRec) {
      const parentValue = normalizeValue(prop, parentRec.styles[prop], ctx.origin);
      if (value === parentValue) continue;
    }
    if (["boxShadow", "textShadow", "filter", "transform", "textDecorationLine", "letterSpacing", "textTransform", "listStyleType", "mixBlendMode"].includes(prop) && isNone(value)) continue;
    if (prop === "opacity" && value === "1") continue;
    if (prop === "visibility" && value === "visible") continue;

    out[prop] = value;
  }

  // Color-prop substitution.
  for (const slot of ctx.colorSlots) {
    for (const use of slot.uses) {
      if (use.nodeN === node.n && use.where === "base" && out[use.cssProp] != null) {
        out[use.cssProp] = `var(${slot.varName})`;
      }
    }
  }

  // Media sizing: fill the box, keep the rendered ratio.
  if (node.kind === "img") {
    delete out.maxWidth;
    out.display = out.display || "block";
    const parentW = parentRec ? contentWidth(parentRec) : 0;
    if (parentW > 0 && rec.box.w >= parentW * 0.96) out.width = "100%";
    if (!isNone(s.objectFit) && s.objectFit !== "fill" && rec.box.h > 0) {
      out.aspectRatio = snapRatio(rec.box.w / rec.box.h);
      out.height = "auto";
    }
  }
  if (node.kind === "embed") {
    const parentW = parentRec ? contentWidth(parentRec) : 0;
    if (parentW > 0 && rec.box.w >= parentW * 0.9) out.width = "100%";
    if (rec.box.h > 0) {
      out.aspectRatio = snapRatio(rec.box.w / rec.box.h);
      // An iframe's height="360" attribute otherwise wins over the CSS
      // ratio, rendering full-width embeds as short letterboxed strips.
      out.height = "auto";
    }
  }
  if (node.kind === "spacer") {
    out.height = `${rec.box.h}px`;
  }

  // The section ROOT is a special case: whatever constrained its width lives
  // on an ancestor *outside* the captured section (a boxed page wrapper), so
  // there is no captured parent to compare against and the constraint is lost
  // entirely — every section then renders full-bleed. Comparing the root's own
  // measured width against the viewport recovers it. Genuinely full-width
  // sections measure ~= the viewport and are left alone.
  if (node.isRoot && rec.box.w > 0 && rec.box.w < bp * 0.95) {
    out.maxWidth = `${rec.box.w}px`;
    out.marginLeft = "auto";
    out.marginRight = "auto";
  }

  // A container rendered narrower than its parent and centred within it is a
  // width-constrained wrapper (`.elementor-container`-style, however it was
  // authored). Its computed max-width is often "none" — the constraint came
  // from width/margins — so without synthesizing one here the layout goes
  // full-bleed and inner "boxed" designs (a white card, a constrained prose
  // column) stretch edge to edge.
  if (["container", "richtext", "raw"].includes(node.kind) && parentRec && !out.maxWidth && !out.flex) {
    const parentFlex = parentRec.styles.display?.includes("flex") && !parentRec.styles.flexDirection?.startsWith("column");
    const pw = contentWidth(parentRec);
    if (!parentFlex && pw > 0 && rec.box.w > 0 && rec.box.w < pw - 60) {
      const padL = parseFloat(parentRec.styles.paddingLeft) || 0;
      const leftGap = rec.box.x - (parentRec.box.x + padL);
      const rightGap = pw - leftGap - rec.box.w;
      if (leftGap > 20 && Math.abs(leftGap - rightGap) <= Math.max(16, leftGap * 0.15)) {
        out.maxWidth = `${rec.box.w}px`;
        out.marginLeft = "auto";
        out.marginRight = "auto";
      } else if (leftGap <= 20 && rightGap > 40) {
        // Not centred but pinned to the parent's content edge: the half-width
        // text column of a hero whose other half is the background photograph.
        // Without a width it fills the row, the copy runs under the image and
        // every heading below wraps differently than the source.
        //
        // A percentage is a share of the *containing block*, and for a grid
        // item that is its track, not the grid. So a gallery cover measured at
        // a quarter of a four-column grid emitted `width: 25%` and rendered at
        // 25% of one 342.5px column — 86px where the source is 341px. In a grid
        // the track already carries the share, so the item states only that it
        // fills it.
        const inGrid = parentRec?.styles?.display?.includes("grid");
        out.width = inGrid ? "100%" : `${snapPercent((rec.box.w / pw) * 100)}%`;
      }
    }
  }

  // Authored height recovery.
  //
  // A computed `height` is a used value, so it is deliberately not baked — for
  // almost every element it merely restates the content. The exception is a
  // band whose height was *authored* (`.hero { height: 500px }`), which the
  // computed styles cannot distinguish from a content-sized one. The rendered
  // geometry can: measure the room the children actually occupy, and if the
  // box is materially taller than its content plus its own padding, the extra
  // space was asked for rather than earned. `min-height` rather than `height`,
  // so the target's own metrics can still push it taller if the copy needs it.
  if (["container", "raw", "decor", "spacer"].includes(node.kind) || node.n === ctx.tree?.n) {
    const kidRecs = (node.children || [])
      .filter((c) => !c.skip)
      .map((c) => ctx.styles[bp]?.[c.n])
      .filter((r) => r?.visible && r.box?.h > 0 && r.styles?.position !== "absolute" && r.styles?.position !== "fixed");
    if (!kidRecs.length && !node.iconName && rec.box.h > 0 && ["decor", "spacer"].includes(node.kind)) {
      // A painted block with no content at all — the photo column of a split
      // section, a divider band. Its height is *only* authored, so without it
      // the block collapses to nothing and the image it carries never appears.
      //
      // Bounded, though: a slice that `splitByAnchors` separated from its
      // children measures the height of the container it came from, and an
      // accordion opened by `disclose.mjs` makes that container enormous. A
      // decorative band is a band; a five-figure one is a stale measurement,
      // and baking it leaves a page that is mostly empty space.
      if (rec.box.h <= MAX_AUTHORED_BAND_PX) out.minHeight = `${Math.round(rec.box.h)}px`;
    } else if (kidRecs.length && rec.box.h > 0) {
      const contentH =
        Math.max(...kidRecs.map((r) => r.box.y + r.box.h)) - Math.min(...kidRecs.map((r) => r.box.y));
      const padY = (parseFloat(s.paddingTop) || 0) + (parseFloat(s.paddingBottom) || 0);
      const slack = rec.box.h - (contentH + padY);
      // An authored band is a *little* taller than its content — a hero asking
      // for 500px around 300px of copy. A box many times taller than what it
      // holds was not authored that way: it is a measurement that no longer
      // describes this node. Two ways that happens here, both real:
      //
      //   - `disclose.mjs` opens every accordion before measuring (it must, or
      //     closed panels capture as empty), so a section containing one
      //     measures its *expanded* height.
      //   - `splitByAnchors` then slices that container into separate
      //     components, and each slice inherits the whole container's geometry.
      //
      // The result was a 226px block floored at 5547px — the "huge gaps" that
      // are the most visible defect a migrated page can have. Baking nothing
      // costs only a band that was genuinely authored taller, which the target's
      // own padding usually restores; baking this is a page nobody can use.
      // Two tests, because either alone lets this through. Proportionality
      // catches a small box floored to a huge number; the absolute ceiling
      // catches the case where the children are huge too — an accordion opened
      // by `disclose.mjs` makes container *and* content both enormous, so the
      // ratio looks reasonable while the number is still nonsense to bake.
      const proportionate = slack <= Math.max(400, contentH + padY);
      const plausible = rec.box.h <= MAX_AUTHORED_BAND_PX;
      if (slack > 24 && proportionate && plausible) out.minHeight = `${Math.round(rec.box.h)}px`;
    }
  }

  // Flex-child basis recovery: a computed width is a used value we refuse to
  // bake, but flex children still need their share of the row.
  // A button is shrink-to-fit in the source — its width IS its content plus
  // padding. Pinning a flex basis on it (as the generic recovery below does
  // for layout children) makes it a few pixels narrower than its own text
  // needs, which is enough to wrap a label onto a second line. Buttons size
  // themselves; only layout children get a basis.
  if (node.kind !== "button" && parentRec?.styles?.display?.includes("flex") && !parentRec.styles.flexDirection?.startsWith("column")) {
    const pw = contentWidth(parentRec);
    if (pw > 0 && rec.box.w > 0) {
      const siblings = Object.values(ctx.styles[bp] || {}).filter((r) => r.parent === String(rec.parent) && r.visible).length;
      const gap = parseFloat(parentRec.styles.columnGap) || 0;
      const available = pw - gap * Math.max(0, siblings - 1);
      if (available > 0) {
        const pct = snapPercent((rec.box.w / available) * 100);
        // Flex's real default basis is "auto" (shrink-to-fit content), not
        // 100% — a row item that happens to span the full row still needs an
        // explicit basis, or it reverts to sizing by its own content and
        // stacks beside its siblings instead of wrapping onto its own line.
        // `flex-basis` resolves against the container, not against the room
        // left after gaps — so a share computed from `available` and emitted as
        // a percentage counts the gaps twice. Four cards measured at 25% of the
        // gap-adjusted row then ask for 4x25% + 3x30px = 1560px inside 1440px,
        // and the last card is clipped off the right edge.
        //
        // Two corrections. The percentage is taken against the full container
        // width, which is what the browser will resolve it against; and the
        // item is allowed to *shrink* (`0 1`, not `0 0`), which is what the
        // source itself does — its cards are `flex: 0 1 auto`. Shrinking is
        // what makes a row of measured widths survive a gap the measurement
        // did not include, or a container narrower than the one measured.
        const basisPct = Math.min(snapPercent((rec.box.w / pw) * 100), 100);
        if ((parseFloat(s.flexGrow) || 0) === 0 && basisPct > 0) {
          out.flex = `0 1 ${basisPct}%`;
          out.maxWidth = `${basisPct}%`;
        }
      }
    }
  }

  // If the source rendered this button's label on ONE line, say so. Font
  // metrics differ just enough between the two renders that a label sized to
  // fit exactly can spill over; nowrap keeps the source's line count. Measured,
  // not assumed — a source button that genuinely wraps is left wrapping.
  if (node.kind === "button" && rec.box.h > 0) {
    const lh = parseFloat(s.lineHeight) || parseFloat(s.fontSize) || 16;
    const vPad = (parseFloat(s.paddingTop) || 0) + (parseFloat(s.paddingBottom) || 0);
    const vBorder = (parseFloat(s.borderTopWidth) || 0) + (parseFloat(s.borderBottomWidth) || 0);
    const lines = Math.round((rec.box.h - vPad - vBorder) / lh);
    if (lines <= 1) out.whiteSpace = "nowrap";
  }

  // A flattened repeat: the container must actually be a wrapping grid (its
  // captured styles describe one narrow column), and each item takes its
  // share of the *outer* width rather than the column it was measured in.
  if (node.flattenLayout) {
    out.display = "flex";
    out.flexWrap = "wrap";
    out.alignContent = "flex-start";
    delete out.flex;
    delete out.maxWidth;
    delete out.flexDirection;
    out.width = "100%";
  }
  if (node.__flattenBasis) {
    out.flex = `0 0 ${node.__flattenBasis}%`;
    out.maxWidth = `${node.__flattenBasis}%`;
  }

  // Recover `margin: auto` centring on a max-width-constrained box.
  //
  // A box authored as `max-width: X; margin: 0 auto` is centred by the browser,
  // which resolves those autos to concrete pixels — half the leftover room at
  // the capture viewport (e.g. 140px each side of an 1140px box at 1440px). We
  // capture the *used* pixels, so the centring is frozen to one viewport and
  // the box sits off-centre (or overflows) at every other width. When a box is
  // width-constrained and its captured left/right margins are positive and near
  // symmetric, that is the auto-centring signature: restore it as `auto` so the
  // box re-centres fluidly instead of carrying a viewport-specific offset.
  //
  // Applies to flex items too: a flex child given a percentage basis and
  // symmetric px margins (a divider rule sized `flex: 0 0 18%` sitting centred
  // in its row) was also auto-centred by the browser, and symmetric `auto`
  // margins re-centre a flex item the same way they do a block. Only the
  // symmetric case is rewritten, so a one-sided auto can never push an item.
  const hasWidthConstraint =
    (out.maxWidth != null && out.maxWidth !== "none") || out.width != null || out.flex != null;
  if (hasWidthConstraint && out.marginLeft != null && out.marginRight != null) {
    const ml = parseFloat(out.marginLeft);
    const mr = parseFloat(out.marginRight);
    if (
      ml > 4 && mr > 4 &&
      /px$/.test(out.marginLeft) && /px$/.test(out.marginRight) &&
      Math.abs(ml - mr) <= Math.max(4, Math.min(ml, mr) * 0.15)
    ) {
      out.marginLeft = "auto";
      out.marginRight = "auto";
    }
  }

  return out;
}

function contentWidth(rec) {
  const s = rec.styles;
  return rec.box.w - (parseFloat(s.paddingLeft) || 0) - (parseFloat(s.paddingRight) || 0);
}

function snapPercent(pct) {
  for (const s of SNAP_PERCENTS) if (Math.abs(pct - s) <= 2) return s;
  return Math.round(pct * 100) / 100;
}

function snapRatio(ratio) {
  const named = [
    [1, "1 / 1"],
    [4 / 3, "4 / 3"],
    [3 / 2, "3 / 2"],
    [16 / 9, "16 / 9"],
    [2 / 1, "2 / 1"],
    [21 / 9, "21 / 9"],
    [3 / 4, "3 / 4"],
    [2 / 3, "2 / 3"],
  ];
  for (const [r, label] of named) if (Math.abs(ratio - r) / r <= 0.03) return label;
  return `${Math.round(ratio * 100) / 100} / 1`;
}

function gridTracks(value) {
  const tracks = value.split(" ").map(parseFloat).filter((n) => !Number.isNaN(n));
  if (tracks.length === 0) return value;
  if (tracks.length === 1) return "1fr";
  const max = Math.max(...tracks);
  const equal = tracks.every((t) => Math.abs(t - max) / max <= 0.03);
  if (equal) return `repeat(${tracks.length}, minmax(0, 1fr))`;
  const total = tracks.reduce((a, b) => a + b, 0);
  return tracks.map((t) => `${Math.round((t / total) * 1000) / 10}%`).join(" ");
}

/** Merge longhand runs into shorthands for readability. */
function shorthand(decls) {
  const out = { ...decls };
  const merge = (names, target, joiner) => {
    if (names.every((n) => out[n] != null)) {
      const values = names.map((n) => out[n]);
      out[target] = joiner(values);
      for (const n of names) delete out[n];
    }
  };
  const box = ([t, r, b, l]) => {
    if (t === r && r === b && b === l) return t;
    if (t === b && r === l) return `${t} ${r}`;
    return `${t} ${r} ${b} ${l}`;
  };
  merge(["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"], "padding", box);
  merge(["marginTop", "marginRight", "marginBottom", "marginLeft"], "margin", box);
  merge(
    ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius"],
    "borderRadius",
    ([tl, tr, br, bl]) => (tl === tr && tr === br && br === bl ? tl : `${tl} ${tr} ${br} ${bl}`)
  );
  merge(["borderTopWidth", "borderTopStyle", "borderTopColor"], "borderTop", (v) => v.join(" "));
  if (out.borderTop && ["borderRightWidth", "borderBottomWidth", "borderLeftWidth"].every((n) => decls[n] === decls.borderTopWidth)) {
    out.border = out.borderTop;
    delete out.borderTop;
    for (const n of ["borderRightWidth", "borderBottomWidth", "borderLeftWidth"]) delete out[n];
  }
  if (out.rowGap != null && out.rowGap === out.columnGap) {
    out.gap = out.rowGap;
    delete out.rowGap;
    delete out.columnGap;
  }
  return out;
}

/**
 * What a wider breakpoint must re-declare on top of the base rule.
 *
 * The subtle half is props present in `base` but *absent* from `next`: absence
 * only means the wider value equals the tag default or the parent's — but the
 * base rule still applies at that width, so a mobile-only value (Elementor
 * centres text and stacks icon boxes below ~768px) leaks upward and the
 * desktop layout renders with phone styling. Every such prop gets an explicit
 * reset to the wider breakpoint's *raw computed* value. Synthesized props
 * (flex/width/aspect-ratio, which have no single raw source) reset from their
 * raw longhands where possible and are otherwise left alone.
 */
function diffDecls(next, base, rawWider, ctx) {
  const out = {};
  for (const [k, v] of Object.entries(next)) {
    if (base[k] !== v) out[k] = v;
  }
  const raw = rawWider?.styles ?? {};
  for (const k of Object.keys(base)) {
    if (k in next) continue;
    if (k === "display") {
      // The wider breakpoint dropped `display` because it matched the UA
      // default — which is not necessarily `block`. An anchor styled
      // `display: block` on mobile and left inline above it would be forced
      // back to block here, stacking two side-by-side buttons full width. The
      // measured value is on hand; use it, exactly as every other property
      // resets from the raw wider capture.
      out.display = next.display ?? raw.display ?? "block";
      continue;
    }
    if (k === "flex") {
      const reset = `${raw.flexGrow ?? 0} ${raw.flexShrink ?? 1} auto`;
      if (reset !== base[k]) out.flex = reset;
      continue;
    }
    if (raw[k] == null) continue; // synthesized with no raw source — leave the base value
    const value = normalizeValue(k, raw[k], ctx?.origin);
    if (value !== base[k]) out[k] = value;
  }
  return out;
}

function ruleText(selector, decls, indent = "  ") {
  const entries = Object.entries(decls)
    .map(([k, v]) => [cssName(k), v])
    .sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return "";
  const body = entries.map(([k, v]) => `${indent}  ${k}: ${v};`).join("\n");
  return `${indent}${selector} {\n${body}\n${indent}}`;
}

function pseudoDecls(node, key, bp, ctx) {
  const rec = ctx.styles[bp]?.[node.n];
  const p = rec?.[key];
  if (!p) return null;
  const out = {
    content: p.content === '""' || p.content === "''" ? '""' : p.content,
  };

  // An empty-content pseudo draws a box and nothing else, so its geometry is
  // the whole declaration. Dropping it emitted `content: ""` on a zero-sized
  // inline box — which is how every `h2::after` divider on the Taylor Dental
  // Care site arrived invisible, with only its colour to show it had ever been
  // measured.
  //
  // Only for a pseudo in normal flow: glyph pseudo-elements take their size
  // from the icon font, and an absolutely-positioned one is already described
  // by the inset written below — measuring its box in pixels would pin it to
  // the viewport it was captured at.
  const inFlow = !p.position || p.position === "static";

  if (out.content === '""' && inFlow) {
    if (p.display && p.display !== "inline") out.display = p.display;
    for (const box of ["width", "height"]) {
      const v = p[box];

      if (v && v !== "auto" && parseFloat(v) !== 0) out[box] = normalizeValue(box, v, ctx.origin);
    }
    for (const side of ["Top", "Right", "Bottom", "Left"]) {
      const v = p[`margin${side}`];

      if (v && v !== "0px" && v !== "auto") out[`margin${side}`] = normalizeValue(`margin${side}`, v, ctx.origin);
      else if (v === "auto") out[`margin${side}`] = "auto";
    }
  }

  if (p.position && p.position !== "static") {
    out.position = p.position;
    for (const side of ["top", "right", "bottom", "left"]) {
      if (p[side] !== "auto") out[side] = normalizeValue(side, p[side], ctx.origin);
    }
  }
  for (const prop of ["backgroundColor", "backgroundImage", "backgroundSize", "backgroundPosition", "backgroundRepeat", "opacity", "mixBlendMode", "transform", "boxShadow", "borderTopLeftRadius", "zIndex", "filter", "pointerEvents"]) {
    let v = p[prop];
    if (v == null || isNone(v)) continue;
    if (prop === "opacity" && v === "1") continue;
    if (prop === "backgroundColor" && normColor(v) === "#000000" && p.backgroundImage !== "none") {
      // black default behind an image is usually paint; keep it anyway
    }
    if (prop === "backgroundPosition" && v === "0% 0%") continue;
    if (prop === "backgroundRepeat" && v === "repeat") continue;
    if (prop === "backgroundSize" && v === "auto") continue;
    if (prop === "zIndex" && v === "auto") continue;
    if (prop === "pointerEvents" && v !== "none") continue;
    if (prop === "backgroundColor" && (normColor(v) === "rgba(0, 0, 0, 0)" || v === "rgba(0, 0, 0, 0)")) continue;
    out[prop === "borderTopLeftRadius" ? "borderRadius" : prop] = normalizeValue(prop, v, ctx.origin);
  }
  const bgi = ctx.backgroundImageProp;
  if (bgi && bgi.nodeN === node.n && bgi.where === (key === "before" ? "before" : "after")) {
    out.backgroundImage = `var(${bgi.varName}, none)`;
  }
  for (const slot of ctx.colorSlots) {
    for (const use of slot.uses) {
      if (use.nodeN === node.n && use.where === key && out[use.cssProp] != null) {
        out[use.cssProp] = `var(${slot.varName})`;
      }
    }
  }
  return out;
}

export function emitCss({ tree, styles, hover, defaults, breakpoints, colorSlots, hoverSlots, backgroundImageProp, origin }) {
  const bps = [...breakpoints].sort((a, b) => a - b);
  const [baseBp, ...widerBps] = bps;
  const desktop = bps[bps.length - 1];
  const ctx = { tree, styles, defaults, breakpoints: bps, colorSlots, backgroundImageProp, origin };

  const nodes = collectEmittable(tree);
  const hoverByNode = new Map();
  for (const [hostN, states] of Object.entries(hover || {})) {
    for (const [n, hstyles] of Object.entries(states)) {
      hoverByNode.set(`${hostN}:${n}`, hstyles);
    }
  }

  const base = [];
  const media = new Map(widerBps.map((bp) => [bp, []]));
  // The shared Button renders outside this component's scope, so its
  // measured overrides must be global to apply at all.
  const clsOf = (node) => (node.kind === "button" ? `:global(.${node.cls})` : `.${node.cls}`);

  for (const node of nodes) {
    if (node.synthetic) {
      // Rich-text container: style its inner tags via :global from the sample nodes.
      for (const [tag, sampleN] of Object.entries(node.samples || {})) {
        const fake = { n: sampleN, tag, kind: "text", cls: node.cls };
        const baseDecls = declsFor(fake, baseBp, ctx);
        if (baseDecls && Object.keys(baseDecls).length) {
          delete baseDecls.display;
          base.push(ruleText(`${clsOf(node)} :global(${tag})`, shorthand(baseDecls)));
        }
        let prev = baseDecls || {};
        for (const bp of widerBps) {
          const decls = declsFor(fake, bp, ctx);
          if (!decls) continue;
          delete decls.display;
          const diff = diffDecls(decls, prev, ctx.styles[bp]?.[sampleN], ctx);
          if (Object.keys(diff).length) media.get(bp).push(ruleText(`${clsOf(node)} :global(${tag})`, shorthand(diff), "    "));
          prev = decls;
        }
      }
      continue;
    }

    const baseDecls = declsFor(node, baseBp, ctx) || {};

    // Transitions only where hover changes something.
    const hasHover = [...hoverByNode.keys()].some((k) => k.endsWith(`:${node.n}`));
    if (hasHover) {
      const s = styles[desktop]?.[node.n]?.styles;
      if (s && s.transitionDuration && parseFloat(s.transitionDuration) > 0) {
        baseDecls.transition = `all ${s.transitionDuration.split(",")[0].trim()} ${s.transitionTimingFunction?.split(",")[0].trim() || "ease"}`;
      }
    }

    if (Object.keys(baseDecls).length) base.push(ruleText(clsOf(node), shorthand(baseDecls)));

    let prev = baseDecls;
    for (const bp of widerBps) {
      const decls = declsFor(node, bp, ctx);
      if (!decls) continue;
      const diff = diffDecls(decls, prev, ctx.styles[bp]?.[node.n], ctx);
      delete diff.transition;
      if (Object.keys(diff).length) media.get(bp).push(ruleText(clsOf(node), shorthand(diff), "    "));
      // Mirror a per-breakpoint nowrap onto Button's label span too. A long
      // label legitimately wraps at 390px and not at 1440px, so the nowrap
      // lives in the media query — and the label needs it in the same place,
      // or `white-space: pre-line` on the span keeps wrapping the text.
      if (node.kind === "button" && diff.whiteSpace === "nowrap") {
        media.get(bp).push(ruleText(`${clsOf(node)} :global(.label-text)`, { whiteSpace: "nowrap" }, "    "));
      }
      prev = decls;
    }

    // On an icon-font element the pseudo-elements ARE the glyph slots (duotone
    // draws its two layers via ::before and ::after). Once the glyph has been
    // replaced by a real SVG those slots are redundant, and emitting them
    // leaves an empty bordered box beside every substituted icon.
    if (!node.iconName) {
      for (const key of ["before", "after"]) {
        const pd = pseudoDecls(node, key, desktop, ctx);
        if (pd) base.push(ruleText(`${clsOf(node)}::${key}`, shorthand(pd)));
      }
    }

    // Button.astro wraps its label in `<span class="label-text">` which sets
    // `white-space: pre-line`, re-enabling wrapping inside an anchor we just
    // told not to wrap. The nowrap has to reach the element that actually holds
    // the text, so it is mirrored onto the label.
    if (node.kind === "button" && baseDecls.whiteSpace === "nowrap") {
      base.push(ruleText(`${clsOf(node)} :global(.label-text)`, { whiteSpace: "nowrap" }));
    }

    // A substituted icon renders as an <svg> inside our span, outside this
    // component's style scope — size it from the glyph's measured font-size.
    if (node.iconName) {
      // Size from the glyph's measured font-size, not `1em`: the substituted
      // SVG sits in a span whose own font-size may be inherited rather than
      // the size the glyph actually rendered at, so `1em` silently shrinks it.
      const rec = styles[desktop]?.[node.n];
      const glyph = parseFloat(rec?.styles?.fontSize);
      const box = Math.min(rec?.box?.w ?? 0, rec?.box?.h ?? 0);
      const size = Number.isFinite(glyph) && glyph > 0 ? glyph : box > 0 ? box : null;
      base.push(
        ruleText(`${clsOf(node)} :global(svg)`, {
          display: "block",
          flexShrink: "0",
          height: size ? `${Math.round(size)}px` : "1em",
          width: size ? `${Math.round(size)}px` : "1em",
        })
      );
    }
  }

  // Hover rules, attributed to the forced host.
  const nodeByN = new Map(nodes.map((n) => [String(n.n), n]));
  const hoverRules = new Map();
  for (const [key, hstyles] of hoverByNode.entries()) {
    const [hostN, n] = key.split(":");
    const host = nodeByN.get(hostN);
    const target = nodeByN.get(n);
    if (!host || !target) continue;
    const baseStyles = styles[desktop]?.[n]?.styles;
    if (!baseStyles) continue;
    const decls = {};
    for (const prop of ["color", "backgroundColor", "borderTopColor", "boxShadow", "opacity", "transform", "textDecorationLine", "letterSpacing", "filter"]) {
      const before = normalizeValue(prop, baseStyles[prop], origin);
      const after = normalizeValue(prop, hstyles[prop], origin);
      if (before !== after && after != null) decls[prop] = after;
    }
    for (const { slot, hostN: hn, nodeN, cssProp } of hoverSlots || []) {
      if (String(hn) === hostN && String(nodeN) === n && decls[cssProp] != null) {
        decls[cssProp] = `var(${slot.varName})`;
      }
    }
    if (!Object.keys(decls).length) continue;
    const selector = host === target ? `${clsOf(host)}:hover` : `${clsOf(host)}:hover ${clsOf(target)}`;
    hoverRules.set(selector, decls);
  }
  for (const [selector, decls] of hoverRules) base.push(ruleText(selector, shorthand(decls)));

  const parts = [base.filter(Boolean).join("\n\n")];
  for (const bp of widerBps) {
    const rules = media.get(bp).filter(Boolean);
    if (rules.length) parts.push(`  @media (min-width: ${bp}px) {\n${rules.join("\n\n")}\n  }`);
  }
  return parts.filter(Boolean).join("\n\n");
}
