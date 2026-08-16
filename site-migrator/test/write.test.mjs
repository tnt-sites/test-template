import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writer, Outcome } from "../src/fs/write.mjs";
import { parseHeader, setFrozen, stripHeader } from "../src/fs/provenance.mjs";
import { upsertRegion, readRegion, markersFor } from "../src/fs/regions.mjs";

let root;
let artifacts;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mig-write-"));
  artifacts = path.join(root, ".migration");
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const newWriter = (opts = {}) =>
  new Writer({ targetRoot: root, artifactsDir: artifacts, ...opts });

const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));

describe("Writer decision table", () => {
  test("creates a new file and stamps provenance", () => {
    const w = newWriter();
    const r = w.write("a.pcss", ".x { color: red; }", { gen: "tokens" });

    assert.equal(r.outcome, Outcome.CREATED);
    const content = read("a.pcss");
    assert.match(content, /mig:generated/);
    const fields = parseHeader("a.pcss", content);
    assert.equal(fields.gen, "tokens");
    assert.equal(stripHeader("a.pcss", content), ".x { color: red; }");
  });

  test("re-writing identical content is a no-op", () => {
    newWriter().write("a.pcss", ".x { color: red; }");
    const r = newWriter().write("a.pcss", ".x { color: red; }");
    assert.equal(r.outcome, Outcome.UNCHANGED);
  });

  test("updates when the file is untouched since we wrote it", () => {
    newWriter().write("a.pcss", ".x { color: red; }");
    const r = newWriter().write("a.pcss", ".x { color: blue; }");
    assert.equal(r.outcome, Outcome.UPDATED);
    assert.match(read("a.pcss"), /color: blue/);
  });

  test("never overwrites a file it did not write", () => {
    fs.writeFileSync(path.join(root, "hand.pcss"), ".hand { color: green; }");
    const r = newWriter().write("hand.pcss", ".gen { color: red; }");

    assert.equal(r.outcome, Outcome.ADOPTED_EXTERNAL);
    assert.equal(read("hand.pcss"), ".hand { color: green; }", "original must survive");
    // Proposals live in the artifact directory, never beside the file: a stray
    // `page.md.mig-new` gets picked up by content-collection globs and dirties
    // a tree that should be clean once the toolkit is removed.
    assert.equal(exists("hand.pcss.mig-new"), false, "must not litter the repo tree");
    assert.ok(
      fs.existsSync(path.join(artifacts, "proposals", "hand.pcss.mig-new")),
      "proposal should be written under .migration/proposals/"
    );
  });

  test("merges non-overlapping hand edits", () => {
    newWriter().write("a.pcss", ["a {}", "b {}", "c {}"].join("\n"));

    // Human edits the last rule.
    const current = read("a.pcss");
    fs.writeFileSync(path.join(root, "a.pcss"), current.replace("c {}", "c { color: hotpink; }"));

    // Toolkit regenerates with a change to the first rule.
    const r = newWriter().write("a.pcss", ["a { color: red; }", "b {}", "c {}"].join("\n"));

    assert.equal(r.outcome, Outcome.MERGED);
    const merged = read("a.pcss");
    assert.match(merged, /a \{ color: red; \}/, "generated change applied");
    assert.match(merged, /c \{ color: hotpink; \}/, "hand edit preserved");
  });

  test("conflicting edits leave the file alone and report failure", () => {
    newWriter().write("a.pcss", ["a {}", "b {}", "c {}"].join("\n"));

    const current = read("a.pcss");
    fs.writeFileSync(path.join(root, "a.pcss"), current.replace("b {}", "b { color: hotpink; }"));

    const w = newWriter();
    const r = w.write("a.pcss", ["a {}", "b { color: navy; }", "c {}"].join("\n"));

    assert.equal(r.outcome, Outcome.CONFLICT);
    assert.match(read("a.pcss"), /hotpink/, "human's version stays on disk");
    assert.equal(exists("a.pcss.mig-new"), false, "must not litter the repo tree");
    assert.ok(fs.existsSync(path.join(artifacts, "proposals", "a.pcss.mig-new")));
    assert.ok(fs.existsSync(path.join(artifacts, "proposals", "a.pcss.mig-conflict.diff")));
    assert.equal(w.failed, true, "a conflict must fail the run");
  });

  test("frozen files are never written again", () => {
    newWriter().write("nav.astro", "<nav>original</nav>");

    const frozen = setFrozen("nav.astro", read("nav.astro"), true);
    fs.writeFileSync(path.join(root, "nav.astro"), frozen);

    const r = newWriter().write("nav.astro", "<nav>regenerated</nav>");
    assert.equal(r.outcome, Outcome.FROZEN);
    assert.match(read("nav.astro"), /original/);
  });

  test("--force overrides frozen and external files", () => {
    fs.writeFileSync(path.join(root, "hand.pcss"), ".hand {}");
    const r = newWriter({ force: true }).write("hand.pcss", ".gen {}");
    assert.equal(r.outcome, Outcome.UPDATED);
    assert.match(read("hand.pcss"), /\.gen/);
  });

  test("dry-run writes nothing at all", () => {
    const w = newWriter({ dryRun: true });
    w.write("a.pcss", ".x {}");
    w.write("b/c/d.astro", "<div />");

    assert.equal(exists("a.pcss"), false);
    assert.equal(exists("b/c/d.astro"), false);
    assert.equal(fs.existsSync(artifacts), false, "no baseline should be recorded either");
    assert.equal(w.results.length, 2);
  });

  test("running the same generation twice is idempotent", () => {
    const files = [
      ["one.pcss", ".one {}"],
      ["two/three.astro", "<p>hi</p>"],
      ["four.yml", "key: value"],
    ];

    const first = newWriter();
    for (const [p, b] of files) first.write(p, b);
    assert.deepEqual(first.summary, { created: 3 });

    const second = newWriter();
    for (const [p, b] of files) second.write(p, b);
    assert.deepEqual(second.summary, { unchanged: 3 });
    assert.equal(second.failed, false);
  });
});

describe("marked regions", () => {
  const file = "astro.config.mjs";

  test("inserts at an anchor when the region is absent", () => {
    const original = "export default defineConfig({\n  site: 'x',\n});\n";
    const next = upsertRegion(original, file, "redirects", "  redirects: {},", {
      after: /defineConfig\(\{/,
    });

    assert.match(next, /mig:begin redirects/);
    assert.match(next, /redirects: \{\}/);
    assert.match(next, /site: 'x'/, "untouched content survives");
  });

  test("replaces only the region body on re-run", () => {
    const original = "export default defineConfig({\n  site: 'x',\n});\n";
    const once = upsertRegion(original, file, "redirects", "  redirects: {},", {
      after: /defineConfig\(\{/,
    });
    const twice = upsertRegion(once, file, "redirects", "  redirects: { a: 1 },");

    assert.match(twice, /redirects: \{ a: 1 \}/);
    assert.doesNotMatch(twice, /redirects: \{\},/, "old body replaced");
    assert.equal(
      (twice.match(/mig:begin redirects/g) || []).length,
      1,
      "must not duplicate the region"
    );
    assert.match(twice, /site: 'x'/);
  });

  test("round-trips the region body", () => {
    const original = "a\nb\n";
    const next = upsertRegion(original, file, "r", "  body-here");
    assert.equal(readRegion(next, file, "r").trim(), "body-here");
  });

  test("throws rather than guess when the anchor is missing", () => {
    assert.throws(
      () => upsertRegion("nothing here", file, "r", "x", { after: /defineConfig\(\{/ }),
      /anchor not found/
    );
  });

  test("uses the right comment syntax per file type", () => {
    assert.match(markersFor("a.pcss", "n").begin, /^\/\* mig:begin n \*\/$/);
    assert.match(markersFor("a.yml", "n").begin, /^# mig:begin n$/);
    assert.match(markersFor("a.astro", "n").begin, /^<!-- mig:begin n -->$/);
  });
});
