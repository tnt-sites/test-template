import assert from "node:assert/strict";
import test from "node:test";
import { srcFromAttrs, LAZY_SRC_ATTRS, PLACEHOLDER_SRC } from "../src/browser/lazy.mjs";

/** Stand in for a DOM element or a parse5 node: name -> value. */
const at = (attrs) => (name) => attrs[name] ?? "";

test("a lazyload img with no src at all resolves from data-src", () => {
  // The exact shape that cost the veneers page four of its five photos.
  assert.equal(
    srcFromAttrs(at({ "data-src": "/wp-content/uploads/2021/08/veneer.jpg" })),
    "/wp-content/uploads/2021/08/veneer.jpg"
  );
});

test("an inline data-URI placeholder loses to the real data-src", () => {
  assert.equal(
    srcFromAttrs(
      at({ src: "data:image/gif;base64,R0lGODlhAQABAAAAACw=", "data-src": "/real.jpg" })
    ),
    "/real.jpg"
  );
});

test("a named spacer file loses to the real data-src", () => {
  assert.equal(
    srcFromAttrs(at({ src: "/assets/img/blank.gif", "data-src": "/real.jpg" })),
    "/real.jpg"
  );
});

test("a real src wins over a stale data-src left behind after the swap", () => {
  assert.equal(srcFromAttrs(at({ src: "/loaded.jpg", "data-src": "/stale.jpg" })), "/loaded.jpg");
});

test("every known loader attribute is honoured", () => {
  for (const name of LAZY_SRC_ATTRS) {
    assert.equal(srcFromAttrs(at({ [name]: "/x.jpg" })), "/x.jpg", `${name} not resolved`);
  }
});

test("an img with nothing usable stays empty rather than inventing a source", () => {
  assert.equal(srcFromAttrs(at({})), "");
  assert.equal(
    srcFromAttrs(at({ src: "data:image/gif;base64,R0lGOD" })),
    "data:image/gif;base64,R0lGOD"
  );
});

test("the placeholder rule does not swallow real filenames that merely contain a keyword", () => {
  // "lazy-river.jpg" is a photo, not a spacer; only a whole-name match counts.
  assert.ok(!PLACEHOLDER_SRC.test("/wp-content/uploads/2021/08/lazy-river.jpg"));
  assert.ok(!PLACEHOLDER_SRC.test("/uploads/blankets-and-pillows.jpg"));
  assert.ok(PLACEHOLDER_SRC.test("/uploads/blank.gif"));
});

// ---- the audit guard that would have caught this in the first place --------
import { diffCoverage, coverageFindings } from "../src/qa/content-coverage.mjs";

const reading = (images, blocks = []) => ({ blocks, headings: { h1: 1, h2: 0, h3: 0 }, images });

test("coverage reports images the source shows and the build does not", () => {
  const c = diffCoverage(
    reading([
      ["veneer.jpg", 1],
      ["laminate.jpg", 1],
    ]),
    reading([["veneer.jpg", 1]])
  );

  assert.deepEqual(c.missingImages, ["laminate.jpg"]);

  const finding = coverageFindings(c).find((f) => f.id === "droppedImages");
  assert.ok(finding, "no droppedImages finding raised");
  assert.equal(finding.builtCount, 1);
});

test("coverage stays quiet when the build carries every source image", () => {
  const c = diffCoverage(reading([["veneer.jpg", 1]]), reading([["veneer.jpg", 1]]));

  assert.deepEqual(c.missingImages, []);
  assert.equal(
    coverageFindings(c).find((f) => f.id === "droppedImages"),
    undefined
  );
});

test("an image the build adds of its own is not a finding", () => {
  const c = diffCoverage(reading([]), reading([["og-default.jpg", 1]]));
  assert.deepEqual(c.missingImages, []);
});
