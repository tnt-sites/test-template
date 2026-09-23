/**
 * Visual validation: is the rendered Astro page actually close to the rendered
 * WordPress page?
 *
 * Two layers, deliberately:
 *
 *   1. Per-element numeric diff — the actionable one. The captured tree stamps
 *      every retained source node, and the generator emits a deterministic
 *      class name for that same node, so the *same logical element* is
 *      addressable on both sides. Diffing geometry and typography per element
 *      yields "heading is 18px too far left, font-size is 8px too large",
 *      which can be fed straight back into a correction.
 *
 *   2. Pixel score — the gate. A single number per section per viewport that
 *      says whether the reconstruction is acceptable overall, plus a diff image
 *      for human review. Pixel diffing alone is a poor diagnostic (it tells you
 *      *that* something moved, never *what*), which is why it is second.
 *
 * A source element with no counterpart on the built side is reported as
 * `missing` — that is the check that catches a whole section silently failing
 * to render.
 */

import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

/** Properties compared numerically, with the tolerance below which we don't care. */
const GEOMETRY = { x: 4, y: 6, width: 4, height: 8 };
const TYPOGRAPHY = {
  fontSize: 0.6,
  fontWeight: 1,
  lineHeight: 1.5,
  letterSpacing: 0.3,
};
const EXACT = ["fontFamily", "textAlign", "color", "backgroundColor", "flexDirection", "display", "justifyContent", "alignItems"];

const px = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Read geometry + typography for every element carrying a marker attribute.
 * Runs on either side; `attr` differs (source uses the capture marker, the
 * built page uses generated class names, keyed by a data attribute we add).
 */
export function MEASURE_BY_CLASS(classNames) {
  const out = {};
  for (const cls of classNames) {
    const el = document.querySelector(`.${cls}`);
    if (!el) {
      out[cls] = null;
      continue;
    }
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    out[cls] = {
      x: Math.round(r.x),
      y: Math.round(r.y + window.scrollY),
      width: Math.round(r.width),
      height: Math.round(r.height),
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing,
      fontFamily: cs.fontFamily,
      textAlign: cs.textAlign,
      color: cs.color,
      backgroundColor: cs.backgroundColor,
      display: cs.display,
      flexDirection: cs.flexDirection,
      justifyContent: cs.justifyContent,
      alignItems: cs.alignItems,
      visible: cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0,
    };
  }
  return out;
}

/**
 * Compare two measurement maps, normalising for the fact that a section sits
 * at a different absolute `y` on each page: vertical offsets are compared
 * *relative to the section root*, so one section starting 200px lower doesn't
 * report every child as displaced.
 */
export function diffMeasurements(source, built, { rootClass } = {}) {
  const findings = [];
  const srcRootY = source[rootClass]?.y ?? 0;
  const bltRootY = built[rootClass]?.y ?? 0;
  const srcRootX = source[rootClass]?.x ?? 0;
  const bltRootX = built[rootClass]?.x ?? 0;

  for (const [cls, s] of Object.entries(source)) {
    if (!s) continue;
    const b = built[cls];

    if (!b) {
      findings.push({ element: cls, kind: "missing", severity: 100, detail: "element not present in the built page" });
      continue;
    }
    if (s.visible && !b.visible) {
      findings.push({ element: cls, kind: "not-rendered", severity: 90, detail: "visible in source, hidden in build" });
      continue;
    }
    if (!s.visible) continue;

    // Geometry, section-relative.
    const rel = {
      x: [s.x - srcRootX, b.x - bltRootX],
      y: [s.y - srcRootY, b.y - bltRootY],
      width: [s.width, b.width],
      height: [s.height, b.height],
    };
    for (const [prop, tol] of Object.entries(GEOMETRY)) {
      const [sv, bv] = rel[prop];
      const delta = bv - sv;
      if (Math.abs(delta) > tol) {
        findings.push({
          element: cls,
          kind: "geometry",
          prop,
          source: sv,
          built: bv,
          delta,
          severity: Math.min(80, Math.abs(delta)),
          detail: describeGeometry(prop, delta),
        });
      }
    }

    for (const [prop, tol] of Object.entries(TYPOGRAPHY)) {
      const sv = px(s[prop]);
      const bv = px(b[prop]);
      if (sv == null || bv == null) continue;
      const delta = bv - sv;
      if (Math.abs(delta) > tol) {
        findings.push({
          element: cls,
          kind: "typography",
          prop,
          source: s[prop],
          built: b[prop],
          delta: Math.round(delta * 100) / 100,
          severity: Math.min(60, Math.abs(delta) * 4),
          detail: `${prop} is ${delta > 0 ? "larger" : "smaller"} by ${Math.abs(Math.round(delta * 100) / 100)}`,
        });
      }
    }

    for (const prop of EXACT) {
      if (s[prop] === b[prop]) continue;
      // A flex container reporting a different direction only matters if it is
      // actually a flex container on the source side.
      if (prop === "flexDirection" && !String(s.display).includes("flex")) continue;
      findings.push({
        element: cls,
        kind: "style",
        prop,
        source: s[prop],
        built: b[prop],
        severity: prop === "textAlign" || prop === "display" ? 50 : 30,
        detail: `${prop}: expected ${s[prop]}, got ${b[prop]}`,
      });
    }
  }

  return findings.sort((a, b) => b.severity - a.severity);
}

function describeGeometry(prop, delta) {
  const n = Math.abs(delta);
  if (prop === "x") return `${n}px too far ${delta > 0 ? "right" : "left"}`;
  if (prop === "y") return `${n}px too ${delta > 0 ? "low" : "high"}`;
  if (prop === "width") return `${n}px too ${delta > 0 ? "wide" : "narrow"}`;
  return `${n}px too ${delta > 0 ? "tall" : "short"}`;
}

/**
 * Pixel comparison. Images are compared on a common canvas: a height mismatch
 * is itself a finding (reported separately), not a reason to refuse to diff.
 */
export function comparePngs(fileA, fileB, outFile) {
  const a = PNG.sync.read(fs.readFileSync(fileA));
  const b = PNG.sync.read(fs.readFileSync(fileB));

  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  const crop = (img) => {
    if (img.width === width && img.height === height) return img;
    const out = new PNG({ width, height });
    PNG.bitblt(img, out, 0, 0, width, height, 0, 0);
    return out;
  };
  const ca = crop(a);
  const cb = crop(b);

  const diff = new PNG({ width, height });
  const mismatched = pixelmatch(ca.data, cb.data, diff.data, width, height, {
    threshold: 0.12,
    includeAA: true,
    alpha: 0.4,
  });

  if (outFile) {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, PNG.sync.write(diff));
  }

  return {
    mismatched,
    total: width * height,
    ratio: mismatched / (width * height),
    heightDelta: b.height - a.height,
    comparedAt: { width, height },
  };
}

/** Group findings per element into the human-readable form the brief asks for. */
export function formatReport(sectionId, viewport, findings, pixel) {
  const lines = [`${sectionId} @ ${viewport}px`];
  if (pixel) {
    lines.push(`  pixel mismatch: ${(pixel.ratio * 100).toFixed(2)}%  (height delta ${pixel.heightDelta}px)`);
  }
  const shown = findings.slice(0, 12);
  for (const f of shown) {
    lines.push(`  - ${f.element}: ${f.detail}`);
  }
  if (findings.length > shown.length) {
    lines.push(`  … ${findings.length - shown.length} more`);
  }
  return lines.join("\n");
}
