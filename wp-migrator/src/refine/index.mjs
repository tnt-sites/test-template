/**
 * The refine loop: turn measured visual differences into CSS corrections.
 *
 * Two principles shape this:
 *
 *   1. **Correct causes, not effects.** A section reported as "72px too short"
 *      is short *because* its type is too small or its padding is wrong.
 *      Emitting `min-height: 72px` would make the number go green while the
 *      layout stays wrong. So typography, colour and alignment — properties
 *      whose correct value the source directly tells us — are corrected, and
 *      derived geometry (y offsets, heights that follow from content) is left
 *      alone and reported instead.
 *
 *   2. **Corrections live in a region the loop owns.** They are appended to the
 *      component's scoped <style> inside a marked region rather than rewritten
 *      into the generated rules. Generation stays deterministic and re-runnable,
 *      the loop can revise its own previous attempt without compounding edits,
 *      and a reviewer can see exactly what the loop changed and why.
 */

import fs from "node:fs";
import path from "node:path";

export const REGION_BEGIN = "/* wpmig:corrections:begin */";
export const REGION_END = "/* wpmig:corrections:end */";

/** Properties safe to copy straight from the source measurement. */
const DIRECT_COPY = new Set([
  "fontSize",
  "lineHeight",
  "letterSpacing",
  "fontWeight",
  "color",
  "backgroundColor",
  "textAlign",
  "justifyContent",
  "alignItems",
  "flexDirection",
  "fontFamily",
]);

/**
 * Deliberately empty.
 *
 * Width looked like a safe correction — a constrained wrapper whose max-width
 * generation failed to synthesize. In practice it is the most dangerous one:
 * inside a flex/grid layout an element's width is *derived* from its parent's
 * track sizing, so pinning `max-width` on each ancestor to make the measured
 * numbers agree starves the real layout. The first run of this loop did exactly
 * that — mean pixel mismatch improved from 36.7% to 33.1% while the icon grid
 * visibly collapsed, because that section is mostly whitespace and the metric
 * did not feel the damage. Geometry findings are therefore reported, never
 * auto-corrected; only properties whose correct value the source states
 * outright (typography, colour, alignment) are safe to copy.
 */
const GEOMETRY_COPY = {};

const cssName = (camel) => camel.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

/**
 * Build a correction plan from a comparison report.
 *
 * Findings are grouped by section → viewport → selector, because a correction
 * that only applies above a breakpoint has to be emitted inside that media
 * query or it will leak down to mobile — the exact class of bug that made the
 * base+diff emission fragile in the first place.
 */
export function planCorrections(report, { baseViewport } = {}) {
  const widths = Object.keys(report.viewports).map(Number).sort((a, b) => a - b);
  const base = baseViewport ?? widths[0];
  const plan = new Map(); // sectionId -> { base: Map<sel,decls>, media: Map<width, Map<sel,decls>> }
  const skipped = [];

  for (const width of widths) {
    for (const section of report.viewports[width] ?? []) {
      if (!plan.has(section.id)) plan.set(section.id, { base: new Map(), media: new Map() });
      const entry = plan.get(section.id);
      const bucket = width === base ? entry.base : (entry.media.get(width) ?? entry.media.set(width, new Map()).get(width));

      for (const f of section.findings) {
        if (f.kind === "missing" || f.kind === "not-rendered") {
          skipped.push({ ...f, section: section.id, width, reason: "structural — needs generation, not CSS" });
          continue;
        }

        let prop = null;
        let value = null;

        if ((f.kind === "typography" || f.kind === "style") && DIRECT_COPY.has(f.prop)) {
          prop = cssName(f.prop);
          value = f.source;
        } else if (f.kind === "geometry" && GEOMETRY_COPY[f.prop]) {
          // Only correct width when the built element is WIDER than the source:
          // a too-narrow element is usually starved by its parent, and forcing
          // a width here would fight the real cause.
          if (f.delta > 0) {
            prop = GEOMETRY_COPY[f.prop];
            value = `${f.source}px`;
          } else {
            skipped.push({ ...f, section: section.id, width, reason: "too narrow — cause is upstream" });
            continue;
          }
        } else {
          skipped.push({ ...f, section: section.id, width, reason: "derived value; correcting it would mask the cause" });
          continue;
        }

        if (value == null || value === "") continue;
        const sel = `.${f.element}`;
        if (!bucket.has(sel)) bucket.set(sel, new Map());
        bucket.get(sel).set(prop, value);
      }
    }
  }

  return { plan, skipped, base, widths };
}

function renderRules(selMap, indent) {
  const out = [];
  for (const [sel, decls] of selMap) {
    if (!decls.size) continue;
    const body = [...decls.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${indent}  ${k}: ${v};`)
      .join("\n");
    out.push(`${indent}${sel} {\n${body}\n${indent}}`);
  }
  return out;
}

/** Render one component's corrections block. */
export function renderCorrections(entry) {
  const parts = [...renderRules(entry.base, "  ")];
  for (const [width, selMap] of [...entry.media.entries()].sort((a, b) => a[0] - b[0])) {
    const rules = renderRules(selMap, "    ");
    if (rules.length) parts.push(`  @media (min-width: ${width}px) {\n${rules.join("\n\n")}\n  }`);
  }
  if (!parts.length) return null;
  return [REGION_BEGIN, ...parts, REGION_END].join("\n");
}

/**
 * Write the corrections into each component's scoped <style>, replacing any
 * previous block so repeated passes revise rather than accumulate. Selectors
 * are rewritten to `:global()` where the generated stylesheet already targets
 * that class globally (buttons render inside a shared component, outside this
 * component's style scope).
 */
export function applyCorrections(targetRoot, namespace, plan) {
  const root = path.join(targetRoot, "src/components/page-sections", namespace);
  const applied = [];

  for (const [sectionId, entry] of plan) {
    const dir = path.join(root, sectionId);
    if (!fs.existsSync(dir)) continue;
    const file = fs.readdirSync(dir).find((f) => f.endsWith(".astro"));
    if (!file) continue;
    const abs = path.join(dir, file);
    let src = fs.readFileSync(abs, "utf8");

    let block = renderCorrections(entry);
    if (block) {
      block = block.replace(/^(\s*)\.([a-z0-9-]+) \{/gm, (whole, pad, cls) =>
        new RegExp(`:global\\(\\.${cls}\\)`).test(src) ? `${pad}:global(.${cls}) {` : whole
      );
    }

    const hasRegion = src.includes(REGION_BEGIN);
    if (hasRegion) {
      const re = new RegExp(`${escapeRe(REGION_BEGIN)}[\\s\\S]*?${escapeRe(REGION_END)}`);
      src = block ? src.replace(re, block) : src.replace(re, "").replace(/\n{3,}/g, "\n\n");
    } else if (block) {
      const close = src.lastIndexOf("</style>");
      if (close === -1) continue;
      src = `${src.slice(0, close)}\n${block}\n${src.slice(close)}`;
    } else {
      continue;
    }

    fs.writeFileSync(abs, src);
    const count = [...entry.base.values()].reduce((a, m) => a + m.size, 0) +
      [...entry.media.values()].reduce((a, sm) => a + [...sm.values()].reduce((b, m) => b + m.size, 0), 0);
    applied.push({ section: sectionId, declarations: count });
  }

  return applied;
}

/**
 * Corrections have to ACCUMULATE across passes.
 *
 * Each pass plans from the *current* report, which by definition no longer
 * contains the findings the previous pass already fixed. Since the corrections
 * block is replaced wholesale on write, planning alone would drop last pass's
 * fixes and the match would snap straight back to baseline — which is exactly
 * what happened on the first run of this loop. So the block is rendered from
 * persisted cumulative state, and each pass merges into it rather than
 * replacing it. Later passes still win on a property they re-correct.
 */
export function loadState(file) {
  if (!fs.existsSync(file)) return new Map();
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const plan = new Map();
  for (const [sectionId, entry] of Object.entries(raw)) {
    plan.set(sectionId, {
      base: new Map(Object.entries(entry.base ?? {}).map(([sel, d]) => [sel, new Map(Object.entries(d))])),
      media: new Map(
        Object.entries(entry.media ?? {}).map(([w, sels]) => [
          Number(w),
          new Map(Object.entries(sels).map(([sel, d]) => [sel, new Map(Object.entries(d))])),
        ])
      ),
    });
  }
  return plan;
}

export function saveState(file, plan) {
  const out = {};
  for (const [sectionId, entry] of plan) {
    out[sectionId] = {
      base: Object.fromEntries([...entry.base].map(([sel, d]) => [sel, Object.fromEntries(d)])),
      media: Object.fromEntries(
        [...entry.media].map(([w, sels]) => [w, Object.fromEntries([...sels].map(([sel, d]) => [sel, Object.fromEntries(d)]))])
      ),
    };
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
}

/** Merge `next` into `into`, with `next` winning on conflicts. */
export function mergePlan(into, next) {
  for (const [sectionId, entry] of next) {
    if (!into.has(sectionId)) into.set(sectionId, { base: new Map(), media: new Map() });
    const target = into.get(sectionId);
    const mergeSels = (dst, src) => {
      for (const [sel, decls] of src) {
        if (!dst.has(sel)) dst.set(sel, new Map());
        for (const [prop, value] of decls) dst.get(sel).set(prop, value);
      }
    };
    mergeSels(target.base, entry.base);
    for (const [width, sels] of entry.media) {
      if (!target.media.has(width)) target.media.set(width, new Map());
      mergeSels(target.media.get(width), sels);
    }
  }
  return into;
}

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
