import fs from "node:fs";
import path from "node:path";
import { upsertRegion, hasRegion } from "../../fs/regions.mjs";

/**
 * Connect the generated theme layer to the build.
 *
 * Writing `src/styles/source/*.pcss` accomplishes nothing on its own — the
 * stylesheet entry point has to import them, and the cascade layer they declare
 * has to exist in the layer order or the whole block is treated as unlayered
 * and wins against everything. Both edits land in files the toolkit only partly
 * owns, so both go through marked regions.
 */

/** Files `mig tokens` emits, in the order they must be imported. */
const SOURCE_IMPORTS = [
  "_tokens.pcss",
  "_ramp.pcss",
  "_fonts.pcss",
  "_source-base.pcss",
  "_chrome.pcss",
];

export function wireStyleImports(writer, targetRoot, stylesDir, { available } = {}) {
  const entry = path.join(stylesDir, "style.pcss");
  const abs = path.resolve(targetRoot, entry);
  if (!fs.existsSync(abs)) {
    return { ok: false, reason: `${entry} not found — cannot import the generated theme layer` };
  }

  // Detect what is actually on disk rather than relying on the caller to say.
  // Different commands emit different files, so a caller-supplied list leaves
  // whichever ones it does not know about generated but never imported.
  const sourceDir = path.resolve(targetRoot, stylesDir, "source");
  const present = fs.existsSync(sourceDir) ? fs.readdirSync(sourceDir) : [];
  const known = available ?? present;

  const imports = SOURCE_IMPORTS.filter((f) => present.includes(f) || known.includes(f))
    .map((f) => `@import "source/${f}";`)
    .join("\n");

  if (!imports) return { ok: false, reason: "no generated theme files to import" };

  const current = fs.readFileSync(abs, "utf8");
  // Imported last so the source theme overrides the template's own variables
  // and base styles; the cascade layers then decide what beats a component.
  const next = upsertRegion(current, abs, "source-theme-imports", imports);

  if (next !== current && !writer.dryRun) fs.writeFileSync(abs, next, "utf8");
  writer.results.push({
    path: entry,
    outcome: next === current ? "unchanged" : hasRegion(current, abs, "source-theme-imports") ? "updated" : "created",
    detail: "region source-theme-imports",
  });

  return { ok: true };
}

/**
 * Insert the source layers into the declared layer order.
 *
 * `source-base` sits above the template's `base` so ported element styling
 * wins, but below `components` so it never overrides a component. `source-bridge`
 * sits above `page-sections` so it can restyle library components, but below
 * `utils`/`overrides` so hand-written escapes still win.
 */
export function wireLayerOrder(writer, targetRoot, layoutFile) {
  const abs = path.resolve(targetRoot, layoutFile);
  if (!fs.existsSync(abs)) {
    return { ok: false, reason: `${layoutFile} not found — cannot declare the source layers` };
  }

  const current = fs.readFileSync(abs, "utf8");
  const declaration = current.match(/@layer\s+([^;]+);/);
  if (!declaration) {
    return { ok: false, reason: `no @layer declaration found in ${layoutFile}` };
  }

  const layers = declaration[1].split(",").map((l) => l.trim());
  if (layers.includes("source-base") && layers.includes("source-bridge")) {
    writer.results.push({ path: layoutFile, outcome: "unchanged", detail: "layer order" });
    return { ok: true, layers };
  }

  const next = [];
  for (const layer of layers) {
    if (layer === "components" && !layers.includes("source-base")) next.push("source-base");
    if (layer === "utils" && !layers.includes("source-bridge")) next.push("source-bridge");
    next.push(layer);
  }

  const updated = current.replace(declaration[0], `@layer ${next.join(", ")};`);
  if (!writer.dryRun) fs.writeFileSync(abs, updated, "utf8");
  writer.results.push({ path: layoutFile, outcome: "updated", detail: "layer order" });

  return { ok: true, layers: next };
}

/**
 * CSS colour keywords a template uses as obvious stand-ins. A real brand is
 * specified as a hex value, so a bare keyword is placeholder by convention.
 */
const PLACEHOLDER_KEYWORDS =
  /^(red|blue|green|yellow|orange|purple|pink|cyan|magenta|lime|teal|navy|darkblue|darkred|hotpink|rebeccapurple)$/i;

/** A fully-saturated primary or secondary — no brand actually ships these. */
function isVividStandIn(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return false;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 255 && min === 0; // #ff0000, #00ff00, #ff00ff, ...
}

function isReplaceable(value) {
  if (value === undefined || value === null || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value !== "string") return false;
  return PLACEHOLDER_KEYWORDS.test(value.trim()) || isVividStandIn(value.trim());
}

/** Merge generated values into a JSON data file, key by key. */
export function patchJson(writer, targetRoot, relPath, patch, { replaceKeys = [] } = {}) {
  const abs = path.resolve(targetRoot, relPath);
  if (!fs.existsSync(abs)) return { ok: false, reason: `${relPath} not found` };

  const current = JSON.parse(fs.readFileSync(abs, "utf8"));
  const next = { ...current };

  // Keys where the measured source value is authoritative regardless of what
  // the template shipped — a stylesheet link for fonts this site never uses is
  // not a preference to preserve, it is wrong.
  for (const key of replaceKeys) {
    if (patch[key] !== undefined) next[key] = patch[key];
  }

  // Fill anything the operator has not deliberately set. A starter template
  // ships vivid stand-in values (`#ff0000`, `blue`, a Google Fonts link for
  // fonts this site does not use); treating those as deliberate is how a
  // migration ends up with the source's palette extracted correctly and the
  // template's placeholder colours still rendering.
  for (const [key, value] of Object.entries(patch)) {
    if (replaceKeys.includes(key)) continue;
    const existing = current[key];

    if (isReplaceable(existing)) {
      next[key] = value;
      continue;
    }

    if (typeof value === "object" && !Array.isArray(value) && typeof existing === "object") {
      next[key] = { ...existing, ...value };
    }
  }

  const serialised = `${JSON.stringify(next, null, 2)}\n`;
  const changed = serialised !== fs.readFileSync(abs, "utf8");
  if (changed && !writer.dryRun) fs.writeFileSync(abs, serialised, "utf8");
  writer.results.push({ path: relPath, outcome: changed ? "updated" : "unchanged" });

  return { ok: true };
}
