/**
 * Segmentation tests for the sidebar split.
 *
 * `AUTO_SEGMENT` runs inside the page, so these drive a real browser against
 * fixtures rather than calling the function directly — geometry is the whole
 * input, and a jsdom-style stub has none.
 *
 * The fixture is the shape that produced this site's worst components: a page
 * banner, a breadcrumb, then a row of [side menu, content column] where the
 * column holds several unrelated designs. Before the split that row was one
 * section, so the side menu and every paragraph landed in a single component,
 * once per page.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { autoSegment } from "../src/detect/segment.mjs";

/** Interior page: banner, breadcrumb, then a sidebar beside a tall content column. */
const INTERIOR_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; box-sizing: border-box; }
  body { width: 1280px; font: 16px/1.5 system-ui; }
  header, footer { background: #eee; height: 90px; }
  .banner { height: 220px; background: #cfd8dc; }
  .breadcrumb { height: 44px; }
  .row { display: flex; }
  .side { width: 25%; padding: 10px; }
  .side a { display: block; padding: 10px; }
  .main { width: 75%; padding: 10px; }
  .block { min-height: 900px; }
</style></head>
<body>
  <header><nav><a href="/a">Home</a><a href="/b">About</a></nav></header>
  <main>
    <div class="banner"><h1>New Patients</h1></div>
    <div class="breadcrumb"><span>Home &gt; New Patients</span></div>
    <div class="row">
      <div class="side">
        <h4>New Patients</h4>
        <a href="/1">Your First Visit</a>
        <a href="/2">New Patient Forms</a>
        <a href="/3">New Patient Specials</a>
        <a href="/4">Frequently Asked Questions</a>
      </div>
      <div class="main">
        <div class="block"><h2>Your First Visit</h2><p>Thank you for choosing us.</p></div>
        <div class="block">
          <h2>New Patient Forms</h2>
          <p>Forms are listed below.</p>
          <ul><li><a href="/f1">Health history</a></li><li><a href="/f2">Consent</a></li></ul>
        </div>
        <div class="block">
          <h2>New Patient Specials</h2>
          <div class="card"><span>Emergency Exam</span><strong>$39</strong><em>Full value $81</em></div>
        </div>
      </div>
    </div>
  </main>
  <footer>footer</footer>
</body></html>`;

/** Two columns of prose beside an image — one design, and must stay one. */
const SPLIT_SECTION = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; box-sizing: border-box; }
  body { width: 1280px; font: 16px/1.5 system-ui; }
  .banner { height: 200px; background: #cfd8dc; }
  .row { display: flex; min-height: 3200px; }
  .text { width: 40%; padding: 20px; }
  .text p, .text ul { min-height: 700px; }
  .media { width: 60%; background: #ddd; }
</style></head>
<body>
  <main>
    <div class="banner"><h1>Sedation</h1></div>
    <div class="row">
      <div class="text">
        <h2>Sedation Dentistry</h2>
        <p>A long description of the service.</p>
        <p>A second paragraph, so the column has real stacked content.</p>
        <ul><li>Nitrous oxide</li><li>Oral sedation</li></ul>
      </div>
      <div class="media"></div>
    </div>
  </main>
</body></html>`;

async function segment(html, opts = {}) {
  const browser = await chromium.launch();

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 940 } });

    await page.setContent(html, { waitUntil: "load" });
    return await autoSegment(page, opts);
  } finally {
    await browser.close();
  }
}

test("a [sidebar, content] row splits into the rail and the column's own sections", async () => {
  const sections = await segment(INTERIOR_PAGE);
  const previews = sections.map((s) => s.textPreview);

  // The side menu is its own section, not glued to the page's prose.
  const rail = sections.find((s) => s.textPreview.startsWith("New Patients Your First Visit"));

  assert.ok(rail, `no sidebar section found in: ${JSON.stringify(previews, null, 2)}`);

  // And the content column contributes its three designs separately.
  for (const heading of ["Your First Visit Thank you", "New Patient Forms Forms", "New Patient Specials Emergency"]) {
    assert.ok(
      sections.some((s) => s.textPreview.startsWith(heading)),
      `expected a section for "${heading}" in: ${JSON.stringify(previews, null, 2)}`
    );
  }
  // Nothing should contain both the rail and the prose.
  assert.ok(
    !sections.some((s) => s.textPreview.includes("Frequently Asked Questions") && s.textPreview.includes("Thank you")),
    "sidebar and content column ended up in the same section"
  );
});

test("--no-split-sidebars restores the previous whole-row behaviour", async () => {
  const sections = await segment(INTERIOR_PAGE, { splitSidebars: false });
  const merged = sections.find((s) => s.textPreview.startsWith("New Patients Your First Visit"));

  assert.ok(merged, "expected the row to remain a single section");
  // The rail's last link and the column's first paragraph in one section is
  // exactly the failure mode; with the flag off it is expected.
  assert.ok(merged.box.h > 2000, "the whole-row section should carry the column's full height");
});

test("a genuine two-column design is left alone and flagged rather than split", async () => {
  const sections = await segment(SPLIT_SECTION);
  const row = sections.find((s) => s.textPreview.startsWith("Sedation Dentistry"));

  assert.ok(row, "the split section should survive as one section");
  assert.match(row.review, /side by side/);
});
