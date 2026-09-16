#!/usr/bin/env node
/**
 * One-time consolidation of the migrated component set.
 *
 * `dev-page` now keys reuse on structure, so a fresh migration would not
 * produce the 226-component set this repo already carries. This rebuilds that
 * existing output in place instead of re-running the whole migration: the
 * refine loop has 20k findings' worth of corrections baked into these files,
 * and re-measuring all 86 pages to fix a naming bug would throw that away.
 *
 *   node bin/consolidate.mjs              # report the plan, change nothing
 *   node bin/consolidate.mjs --verbose    # ...and say why anything stays put
 *   node bin/consolidate.mjs --apply      # write it
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildMergePlan } from "../src/generate/merge-plan.mjs";
import { MERGE_RULES } from "../src/generate/merge-rules.mjs";
import {
  renameProps,
  guardSlots,
  promoteSlotsToRaw,
  escapeForRaw,
  liftImageDimensions,
} from "../src/generate/reconstruct.mjs";
import { collectUsage, placeComponent } from "../src/generate/placement.mjs";
import { rewriteSidecars } from "../src/generate/sidecars.mjs";
import { kebabToPascal, assertRoundTrips } from "../src/generate/names.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TARGET = path.resolve(HERE, "..", "..");
const SECTIONS = path.join(TARGET, "src/components/page-sections");
const NAMESPACE = "wpmig";
const WPMIG = path.join(SECTIONS, NAMESPACE);
const PAGES = path.join(TARGET, "src/content/pages");

const apply = process.argv.includes("--apply");
const verbose = process.argv.includes("--verbose");
const threshold = Number(
  process.argv.find((a) => a.startsWith("--threshold="))?.split("=")[1] ?? 0.85
);

function loadComponents(dir) {
  return fs
    .readdirSync(dir)
    .filter((d) => fs.statSync(path.join(dir, d)).isDirectory())
    .map((name) => {
      const file = fs.readdirSync(path.join(dir, name)).find((f) => f.endsWith(".astro"));
      const read = (kind) => {
        const p = path.join(dir, name, `${name}.cloudcannon.${kind}.yml`);

        return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
      };

      return {
        name,
        file,
        source: fs.readFileSync(path.join(dir, name, file), "utf8"),
        sidecars: {
          inputs: read("inputs"),
          structureValue: read("structure-value"),
          snippets: read("snippets"),
        },
      };
    });
}

const components = loadComponents(WPMIG);
const byName = new Map(components.map((c) => [c.name, c]));
const usage = collectUsage(PAGES, NAMESPACE, fs, path);
const { plan, problems } = buildMergePlan(components, { threshold, rules: MERGE_RULES });

if (problems.length) {
  console.error(`${problems.length} problem(s) — refusing to plan:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

/**
 * Flatten the clusters into the final component set.
 *
 * Every merge group becomes one component under its canonical's source; every
 * member left standalone keeps its own name and source. `remap` records how a
 * page's existing prop keys must be rewritten to address the component that
 * will now render it.
 */
const finals = [];

for (const cluster of plan) {
  if (cluster.merged.length) {
    const memberNames = cluster.merged.map((m) => m.name);

    finals.push({
      name: cluster.name,
      folder: cluster.folder ?? placeComponent(memberNames, usage),
      source: byName.get(cluster.canonical).source,
      sidecars: byName.get(cluster.canonical).sidecars,
      canonicalName: cluster.canonical,
      rename: cluster.rename,
      optional: cluster.optional,
      promoteToRaw: cluster.promoteToRaw,
      varyingImages: cluster.varyingImages,
      canonicalDims: cluster.canonicalDims,
      from: cluster.merged.map((m) => ({
        name: m.name,
        remap: m.remap,
        escape: m.escapeContent ?? [],
        dims: m.dims ?? {},
      })),
    });
  }
  for (const s of cluster.standalone) {
    finals.push({
      name: s.name,
      folder: placeComponent([s.name], usage),
      source: byName.get(s.name).source,
      sidecars: byName.get(s.name).sidecars,
      canonicalName: s.name,
      rename: {},
      optional: [],
      promoteToRaw: [],
      varyingImages: [],
      canonicalDims: {},
      from: [{ name: s.name, remap: {}, escape: [], dims: {} }],
    });
  }
}

// Names must be unique across the whole set, and must survive renderBlock's
// kebab -> Pascal -> kebab round trip or the component registers under a
// different key than its folder and silently renders nothing.
const seen = new Map();

for (const f of finals) {
  assertRoundTrips(f.name);
  if (seen.has(f.name)) {
    console.error(
      `name collision: "${f.name}" claimed by both ${seen.get(f.name)} and ${f.from[0].name}`
    );
    process.exit(1);
  }
  seen.set(f.name, f.from[0].name);
}

const moves = new Map();

for (const f of finals) {
  for (const src of f.from) {
    // `src.remap` is already the per-member answer: the planner gives the
    // canonical the rule's `rename` and every other member its own remap.
    // Merging `f.rename` in here as well re-applied the canonical's rename to
    // all 47 other banners, renaming their `heading` to `eyebrow` and dropping
    // every page's <h1> to an <h3>.
    // Only the pages whose image differs from the baked default need to carry
    // dimensions; the rest fall through to the same values as before.
    const dims = {};

    for (const prop of f.varyingImages) {
      const d = src.dims[prop];

      if (d && (d.w !== f.canonicalDims[prop].w || d.h !== f.canonicalDims[prop].h)) dims[prop] = d;
    }
    moves.set(src.name, {
      to: `page-sections/${f.folder}/${f.name}`,
      remap: src.remap,
      escape: new Set(src.escape),
      dims,
    });
  }
}

// ---- report -------------------------------------------------------------
const byFolder = {};

for (const f of finals) (byFolder[f.folder] ??= []).push(f.name);

console.log(`${components.length} components -> ${finals.length}\n`);
for (const [folder, names] of Object.entries(byFolder).sort()) {
  console.log(`  ${folder}/  ${names.length}`);
}
console.log();
for (const c of plan.filter((x) => x.merged.length > 1)) {
  const named = c.name === c.canonical ? c.name : `${c.canonical} -> ${c.name}`;

  console.log(
    `[${String(c.size).padStart(2)}] ${named.padEnd(34)} merge ${c.merged.length}` +
      `${c.standalone.length ? `, keep ${c.standalone.length} separate` : ""}`
  );
  if (verbose)
    for (const s of c.standalone) console.log(`        ! ${s.name}: ${s.why.join("; ")}`);
}

if (!apply) {
  console.log("\ndry run — pass --apply to write");
  process.exit(0);
}

// ---- write --------------------------------------------------------------
for (const f of finals) {
  const dir = path.join(SECTIONS, f.folder, f.name);

  fs.mkdirSync(dir, { recursive: true });

  const source = liftImageDimensions(
    guardSlots(promoteSlotsToRaw(renameProps(f.source, f.rename), f.promoteToRaw), f.optional),
    f.varyingImages,
    f.canonicalDims
  );

  // Dimensions lifted out of the markup become editable fields, defaulting to
  // the value that was baked in.
  const extraProps = f.varyingImages.flatMap((prop) => [
    { name: `${prop}Width`, input: "number", value: Number(f.canonicalDims[prop].w) },
    { name: `${prop}Height`, input: "number", value: Number(f.canonicalDims[prop].h) },
  ]);
  const yml = rewriteSidecars({
    sources: f.sidecars,
    oldName: f.canonicalName,
    newName: f.name,
    folder: f.folder,
    rename: f.rename,
    extraProps,
  });

  fs.writeFileSync(path.join(dir, `${kebabToPascal(f.name)}.astro`), source);
  fs.writeFileSync(path.join(dir, `${f.name}.cloudcannon.inputs.yml`), yml.inputs);
  fs.writeFileSync(path.join(dir, `${f.name}.cloudcannon.structure-value.yml`), yml.structureValue);
  fs.writeFileSync(path.join(dir, `${f.name}.cloudcannon.snippets.yml`), yml.snippets);
}
console.log(`\nwrote ${finals.length} components`);

// ---- rewrite content ----------------------------------------------------
let touched = 0;
let rewritten = 0;
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!entry.name.endsWith(".md")) continue;

    const before = fs.readFileSync(full, "utf8");
    // Blocks are YAML: a `_component:` line opens a block whose keys run until
    // the next list item at the same indent. Prop renames must stay inside the
    // block they belong to, so this walks line by line rather than replacing
    // globally — `heading:` means different things in different blocks.
    const lines = before.split("\n");
    let active = null;

    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(\s*-?\s*)_component:\s*page-sections\/wpmig\/([a-z0-9-]+)\s*$/);

      if (m) {
        const move = moves.get(m[2]);

        if (!move) throw new Error(`${path.relative(TARGET, full)}: no destination for "${m[2]}"`);
        lines[i] = `${m[1]}_component: ${move.to}`;
        active = move;
        rewritten++;
        continue;
      }
      if (lines[i].match(/^\s*-\s*\S/) && !lines[i].includes("_component:")) active = null;
      // Renaming is not the only reason to touch a block: a slot promoted to
      // raw needs its value escaped, and a page whose image differs from the
      // merged component's default needs dimensions written in.
      if (!active) continue;
      if (
        !Object.keys(active.remap).length &&
        !active.escape.size &&
        !Object.keys(active.dims).length
      )
        continue;
      const k = lines[i].match(/^(\s+)([a-zA-Z_$][\w$]*)(:)(.*)$/);

      if (!k) continue;
      const finalName = active.remap[k[2]] ?? k[2];
      let rest = k[4];

      // The merged component injects this slot raw where the page's old one
      // interpolated it, so the stored value has to be escaped to render the
      // same. Block scalars carry their content on the following lines.
      if (active.escape.has(k[2])) {
        if (/^\s*\|/.test(rest)) {
          const indent = k[1].length;

          for (let j = i + 1; j < lines.length; j++) {
            if (lines[j].trim() && lines[j].search(/\S/) <= indent) break;
            lines[j] = lines[j].replace(
              /^(\s*)([\s\S]*)$/,
              (_m, pad, body) => pad + escapeForRaw(body)
            );
          }
        } else {
          const quoted = rest.match(/^(\s*)"((?:[^"\\]|\\.)*)"(\s*)$/);

          rest = quoted
            ? `${quoted[1]}"${escapeForRaw(quoted[2])}"${quoted[3]}`
            : rest.replace(/^(\s*)(.*?)(\s*)$/, (_m, a, body, b) => a + escapeForRaw(body) + b);
        }
      }
      if (finalName !== k[2] || rest !== k[4]) lines[i] = `${k[1]}${finalName}${k[3]}${rest}`;

      // This page's image is a different shape from the one baked into the
      // shared component, so it carries its own dimensions.
      const dim = active.dims[finalName];

      if (dim) {
        lines.splice(
          i + 1,
          0,
          `${k[1]}${finalName}Width: ${dim.w}`,
          `${k[1]}${finalName}Height: ${dim.h}`
        );
        i += 2;
      }
    }

    const after = lines.join("\n");

    if (after !== before) {
      fs.writeFileSync(full, after);
      touched++;
    }
  }
};

walk(PAGES);
console.log(`rewrote ${rewritten} component references across ${touched} pages`);

fs.rmSync(WPMIG, { recursive: true, force: true });
console.log(`removed ${path.relative(TARGET, WPMIG)}/`);
