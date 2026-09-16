import assert from "node:assert/strict";
import test from "node:test";
import { structureHash, structureTokens, similarity } from "../src/generate/structure-hash.mjs";

/**
 * The toothbar site produced page-banner, -c, -d, -f and -h: five copies of one
 * banner that differed only in measurement noise. These pin the specific
 * readings that forked them.
 */
const banner = ({ minHeight, top, scale, image }) => `---
/**
 * Page Banner — migrated from who-we-are [0] (auto) by wp-migrator.
 */
const {
  heading = "",
  backgroundImage = "${image}",
  headingColor = "#ffffff",
} = Astro.props;
---
<div class="page-banner">
  <div class="pb-box"><h1 class="pb-heading">{heading}</h1></div>
</div>
<style>
  .page-banner {
    display: flex;
    min-height: ${minHeight}px;
    padding-top: 62.4px;
  }
  .pb-box {
    position: absolute;
    top: ${top}px;
  }
  .pb-heading:hover {
    transform: matrix(${scale}, 0, 0, ${scale}, 0, 0);
  }
</style>
`;

const A = banner({ minHeight: 426, top: 362.4, scale: "1.06664", image: "/a.jpg" });
const D = banner({ minHeight: 470, top: 406.4, scale: "1.06667", image: "/b.webp" });
const H = banner({ minHeight: 470, top: 406.4, scale: "1.05758", image: "/a.jpg" });

test("a 44px min-height difference does not fork the hash", () => {
  assert.equal(structureHash(A), structureHash(D));
});

test("hover transform precision does not fork the hash", () => {
  assert.equal(structureHash(D), structureHash(H));
});

test("all five toothbar banner readings collapse to one component", () => {
  const hashes = new Set([A, D, H].map(structureHash));
  assert.equal(hashes.size, 1, `expected 1 component, got ${hashes.size}`);
});

test("a genuinely different layout still gets its own hash", () => {
  const twoColumn = A.replace('<div class="pb-box">', '<div class="pb-box"><aside/>');
  assert.notEqual(structureHash(A), structureHash(twoColumn));
});

test("a real design difference in min-height is still a difference", () => {
  // 426 -> 470 is noise; 426 -> 900 is a different design.
  assert.notEqual(
    structureHash(A),
    structureHash(banner({ minHeight: 900, top: 362.4, scale: "1.06664", image: "/a.jpg" }))
  );
});

test("near-identical banners score far above any sane reuse threshold", () => {
  assert.ok(similarity(structureTokens(A), structureTokens(H)) > 0.95);
});
