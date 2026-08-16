import fs from "node:fs";
import path from "node:path";
import { parseHeader, isFrozen, stripHeader, hashBody } from "./provenance.mjs";

/**
 * Report the ownership state of every file the toolkit has written.
 *
 * The point is to make the boundary between generated and hand-owned work
 * visible at any moment, so an operator can tell what a re-run would touch
 * before running it.
 */

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

export function collectStatus(ctx) {
  const baselineDir = path.join(ctx.paths.artifacts, "baseline");
  const rows = [];

  for (const baselineFile of walk(baselineDir)) {
    const rel = path.relative(baselineDir, baselineFile);
    const target = path.join(ctx.paths.targetRoot, rel);

    if (!fs.existsSync(target)) {
      rows.push({ path: rel, state: "deleted" });
      continue;
    }

    const current = fs.readFileSync(target, "utf8");
    const baseline = fs.readFileSync(baselineFile, "utf8");
    const fields = parseHeader(target, current);

    if (isFrozen(fields)) rows.push({ path: rel, state: "frozen" });
    else if (current === baseline) rows.push({ path: rel, state: "generated" });
    else rows.push({ path: rel, state: "hand-edited" });
  }

  // Anything the toolkit proposed but could not apply.
  const proposals = path.join(ctx.paths.artifacts, "proposals");
  for (const f of walk(proposals)) {
    const rel = path.relative(proposals, f);
    if (f.endsWith(".mig-conflict.diff")) rows.push({ path: rel, state: "conflict" });
    else if (f.endsWith(".mig-new")) rows.push({ path: rel, state: "pending-proposal" });
  }

  rows.sort((a, b) => a.state.localeCompare(b.state) || a.path.localeCompare(b.path));
  return rows;
}

export function reportStatus(ctx) {
  const rows = collectStatus(ctx);

  if (rows.length === 0) {
    console.log("Nothing generated yet.");
    return rows;
  }

  const counts = {};
  for (const r of rows) counts[r.state] = (counts[r.state] ?? 0) + 1;

  for (const [state, count] of Object.entries(counts)) {
    console.log(`${state.padEnd(18)} ${count}`);
  }

  const notable = rows.filter((r) =>
    ["conflict", "pending-proposal", "hand-edited", "deleted"].includes(r.state)
  );
  if (notable.length) {
    console.log("");
    for (const r of notable) console.log(`  ${r.state.padEnd(18)} ${r.path}`);
  }

  if (counts.conflict) process.exitCode = 1;
  return rows;
}

/** Lint emitted CloudCannon YAML for the structure-value key-order footgun. */
export function lintStructureValueOrder(componentsDir) {
  const problems = [];
  for (const f of walk(componentsDir)) {
    if (!f.endsWith(".cloudcannon.structure-value.yml")) continue;
    const text = fs.readFileSync(f, "utf8");
    const structures = text.search(/^_structures:/m);
    const inputsGlob = text.search(/^_inputs_from_glob:/m);
    if (structures !== -1 && inputsGlob !== -1 && structures < inputsGlob) {
      problems.push(f);
    }
  }
  return problems;
}

export { hashBody, stripHeader };
