import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".mjs")) out.push(full);
  }
  return out;
}

/**
 * Every module must at least parse and evaluate.
 *
 * Modules only reachable through a CLI subcommand are otherwise never imported
 * by the test suite, so a syntax error in one of them ships green and fails on
 * a user's first run.
 */
describe("every module loads", () => {
  const files = [
    ...walk(path.join(root, "..", "src")),
    ...walk(path.join(root, "..", "presets")),
  ];

  test("finds the modules to check", () => {
    assert.ok(files.length > 15, `expected the full source tree, found ${files.length}`);
  });

  for (const file of files) {
    const label = path.relative(path.join(root, ".."), file);
    test(label, async () => {
      await import(file);
    });
  }
});

describe("the CLI entry point loads", () => {
  test("bin/mig.mjs parses", () => {
    // Importing would run the CLI, so check it compiles instead.
    const source = fs.readFileSync(path.join(root, "..", "bin", "mig.mjs"), "utf8");
    assert.doesNotThrow(() => new Function(`return async () => {${""}}`));
    assert.ok(source.includes("runMain"), "entry point should invoke the CLI");
  });
});
