import assert from "node:assert/strict";
import test from "node:test";
import {
  PATTERN_META,
  SMELL_META,
  comparePatterns,
  actionableFindings,
} from "../src/qa/layout-patterns.mjs";

const byId = (findings, id) => findings.find((f) => f.id === id);

test("a pattern the source does not have is never reported", () => {
  const findings = comparePatterns({}, { overlayHeader: ["header"] }, {});

  assert.equal(findings.length, 0);
});

test("a pattern the source has and the build lost is actionable", () => {
  const findings = comparePatterns({ fixedBackground: ["div.welcome"] }, {}, {});
  const finding = byId(findings, "fixedBackground");

  assert.equal(finding.status, "missing");
  assert.equal(finding.hint, PATTERN_META.fixedBackground.hint);
  assert.deepEqual(actionableFindings(findings), [finding]);
});

test("a pattern present on both sides is kept, and stays out of the to-do list", () => {
  const findings = comparePatterns({ hoverCaption: ["figure"] }, { hoverCaption: ["figure"] }, {});

  assert.equal(byId(findings, "hoverCaption").status, "kept");
  assert.deepEqual(actionableFindings(findings), []);
});

test("a build that kept some of a repeated pattern is partial, not silent", () => {
  const findings = comparePatterns(
    { hoverCaption: ["a", "b", "c", "d"] },
    { hoverCaption: ["a"] },
    {}
  );
  const finding = byId(findings, "hoverCaption");

  assert.equal(finding.status, "partial");
  assert.equal(finding.sourceCount, 4);
  assert.equal(finding.builtCount, 1);
  // Partial is a nudge, not a blocker: something did survive.
  assert.deepEqual(actionableFindings(findings), []);
});

test("a built-only smell needs no source counterpart to be reported", () => {
  const findings = comparePatterns({}, {}, { iconClassCollision: ['h2.fa-heading — class "fa-heading"'] });
  const finding = byId(findings, "iconClassCollision");

  assert.equal(finding.kind, "smell");
  assert.equal(finding.status, "present");
  assert.equal(finding.hint, SMELL_META.iconClassCollision.hint);
  assert.deepEqual(actionableFindings(findings), [finding]);
});

test("every detected id carries a label and a fix", () => {
  for (const meta of [...Object.values(PATTERN_META), ...Object.values(SMELL_META)]) {
    assert.ok(meta.label && meta.label.length > 0);
    assert.ok(meta.hint && meta.hint.length > 0);
  }
});

test("the divider under a heading is a pattern, not a smell", () => {
  const findings = comparePatterns({ headingRule: ["h2 \"Our Services\""] }, {}, {});
  const finding = byId(findings, "headingRule");

  assert.equal(finding.kind, "pattern");
  assert.equal(finding.status, "missing");
});

test("a section that renders nothing is reported off the build alone", () => {
  const findings = comparePatterns({}, {}, { emptySection: ["section.section (styled 36px/uppercase)"] });

  assert.equal(byId(findings, "emptySection").status, "present");
  assert.equal(actionableFindings(findings).length, 1);
});
