import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { compareSurfaces } from "../src/qa/surfaces.mjs";

/** A section that paints nothing, so each case only states what it changes. */
const plain = (overrides = {}) => ({
  index: 0,
  label: "div.block",
  background: "rgb(255, 255, 255)",
  backgroundImage: "none",
  border: "none",
  radius: "0px",
  shadow: "none",
  height: 560,
  ...overrides,
});

describe("section surface comparison", () => {
  test("identical sections match", () => {
    const rows = compareSurfaces([plain()], [plain()]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "match");
    assert.deepEqual(rows[0].differs, []);
  });

  test("catches a border dropped alongside a ported background", () => {
    // The real fault: `.block:nth-of-type(even) { background-color: #f2f2f2;
    // border: 1px solid #000 }` read as `backgroundColor: surface`. The tint
    // came across, the outline did not.
    const source = [plain({ background: "rgb(242, 242, 242)", border: "1px solid rgb(0, 0, 0)" })];
    const target = [plain({ background: "rgb(234, 234, 234)", height: 558 })];

    const rows = compareSurfaces(source, target);
    assert.equal(rows[0].status, "differs");
    assert.deepEqual(
      rows[0].differs.map((d) => d.key),
      ["background", "border"]
    );
  });

  test("a 2px height change from a lost border stays inside tolerance", () => {
    // Which is exactly why the paint properties have to be compared directly:
    // the height pass calls this a match.
    const rows = compareSurfaces([plain({ height: 562 })], [plain({ height: 560 })]);
    assert.equal(
      rows[0].differs.some((d) => d.key === "height"),
      false
    );
  });

  test("catches a section rendered on the template's own component", () => {
    // `div.why`: 204px in the source, 347px mapped onto a generic heading and
    // a vertical list. No id, so the id-keyed height pass never sees it.
    const rows = compareSurfaces([plain({ label: "div.why", height: 204 })], [
      plain({ label: "section.custom-section", height: 347 }),
    ]);

    const height = rows[0].differs.find((d) => d.key === "height");
    assert.ok(height);
    assert.equal(height.source, "204px");
    assert.equal(height.target, "347px (+143)");
  });

  test("height tolerance is configurable", () => {
    const source = [plain({ height: 560 })];
    const target = [plain({ height: 574 })];

    assert.equal(compareSurfaces(source, target, { tolerancePx: 8 })[0].status, "differs");
    assert.equal(compareSurfaces(source, target, { tolerancePx: 20 })[0].status, "match");
  });

  test("reports unpaired sections on both sides", () => {
    const rows = compareSurfaces([plain(), plain({ index: 1 })], [plain()]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].status, "match");
    assert.equal(rows[1].status, "unpaired-source");

    const other = compareSurfaces([plain()], [plain(), plain({ index: 1 })]);
    assert.equal(other[1].status, "unpaired-target");
  });
});
