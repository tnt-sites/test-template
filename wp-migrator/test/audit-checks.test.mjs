import assert from "node:assert/strict";
import test from "node:test";
import { diffCoverage, coverageFindings } from "../src/qa/content-coverage.mjs";
import {
  prefixCollisions,
  duplicateFamilies,
  hoverFillOnInvisibleOverlay,
} from "../src/qa/component-hygiene.mjs";

const reading = (blocks, headings = {}) => ({
  blocks: blocks.map(([key, count = 1, tag = "p"], i) => [key, { tag, count, order: i + 1 }]),
  headings: { h1: 1, h2: 0, h3: 0, ...headings },
});

const byId = (findings, id) => findings.find((f) => f.id === id);

test("a source section the build never renders is dropped", () => {
  const coverage = diffCoverage(
    reading([["schedule your first visit today"], ["we are committed to quality care"]]),
    reading([["we are committed to quality care"]])
  );

  assert.equal(coverage.dropped.length, 1);
  assert.equal(coverage.dropped[0].key, "schedule your first visit today");
  assert.equal(byId(coverageFindings(coverage), "droppedContent").status, "present");
});

test("text the build adds of its own is not a finding", () => {
  const coverage = diffCoverage(
    reading([["we are committed to quality care"]]),
    reading([["we are committed to quality care"], ["read the article for more"]])
  );

  assert.deepEqual(coverage.dropped, []);
  assert.deepEqual(coverage.duplicated, []);
});

test("text the source says once and the build says twice is duplicated", () => {
  const coverage = diffCoverage(
    reading([["home is where the dentist is"]]),
    reading([["home is where the dentist is", 2]])
  );

  assert.equal(coverage.duplicated[0].times, 2);
  assert.match(byId(coverageFindings(coverage), "duplicatedContent").examples[0], /x2/);
});

test("text repeated in the source is not reported when the build repeats it too", () => {
  const coverage = diffCoverage(
    reading([["call our office today to book", 2]]),
    reading([["call our office today to book", 2]])
  );

  assert.deepEqual(coverage.duplicated, []);
});

test("a build with no h1 is reported; one with exactly one is not", () => {
  const none = coverageFindings(diffCoverage(reading([], { h1: 1 }), reading([], { h1: 0 })));

  assert.equal(byId(none, "headingCount").label, "Page has no <h1>");

  const two = coverageFindings(diffCoverage(reading([], { h1: 1 }), reading([], { h1: 2 })));

  assert.equal(byId(two, "headingCount").label, "Page has more than one <h1>");

  // The source captions some banners with a `<span>`; one `<h1>` is correct
  // whatever the source did, so it is never a finding.
  const one = coverageFindings(diffCoverage(reading([], { h1: 0 }), reading([], { h1: 1 })));

  assert.equal(byId(one, "headingCount"), undefined);
});

const component = (name, body) => ({ name, file: `/x/${name}`, source: body });

test("two components claiming one class prefix are reported", () => {
  const collisions = prefixCollisions([
    component("MediaProseWhat.astro", '<h2 class="mpw-heading">a</h2><p class="mpw-text">b</p>'),
    component("MediaProseWho.astro", '<h2 class="mpw-heading">c</h2>'),
    component("CardGrid.astro", '<h2 class="cg-heading">d</h2>'),
  ]);

  assert.equal(collisions.length, 1);
  assert.equal(collisions[0].prefix, "mpw");
  assert.deepEqual(collisions[0].files, ["MediaProseWhat.astro", "MediaProseWho.astro"]);
});

test("one section emitted twice under different names is one family", () => {
  const markup = (prefix) => `---
const { heading = "" } = Astro.props;
---
<div class="${prefix}">
  <div class="${prefix}-box">
    <h2 class="${prefix}-heading">{heading}</h2>
    <p class="${prefix}-text">{text}</p>
  </div>
</div>
<style>
  .${prefix} { padding: 30px; }
</style>`;

  const groups = duplicateFamilies([
    component("MediaProseB.astro", markup("mpb")),
    component("MediaProseScheduleYour.astro", markup("mpsy")),
    component("Unrelated.astro", '---\n---\n<section class="u"><img class="u-media" /></section>'),
  ]);

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].sort(), ["MediaProseB.astro", "MediaProseScheduleYour.astro"]);
});

test("an invisible overlay that paints on hover is reported", () => {
  const found = hoverFillOnInvisibleOverlay([
    component(
      "MediaProse.astro",
      `<style>
  .mp-link { opacity: 0; font-size: 0px; position: absolute; }
  .mp-link:hover { background-color: #a6ce39; opacity: 1; }
  .mp-heading { color: #fff; }
  .mp-heading:hover { color: #a6ce39; }
</style>`
    ),
  ]);

  assert.equal(found.length, 1);
  assert.equal(found[0].cls, "mp-link");
  assert.equal(found[0].fill, "#a6ce39");
});

test("a hover that only restores opacity is the intended reveal, not a fill", () => {
  const found = hoverFillOnInvisibleOverlay([
    component(
      "MediaProse.astro",
      `<style>
  .mp-link { opacity: 0; }
  .mp-link:hover { opacity: 1; }
</style>`
    ),
  ]);

  assert.deepEqual(found, []);
});
