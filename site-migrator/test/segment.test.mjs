import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { instrumentHtml } from "../src/mirror/instrument.mjs";
import { serve } from "../src/mirror/serve.mjs";
import { segmentPage } from "../src/sections/segment.mjs";

/**
 * The segmenter decides what a "section" is, and every later stage depends on
 * it. Each bug fixed here shipped once already, so each has a test.
 */

const NORMALIZER = {
  noiseClasses: ["wow", "fade\\w*", "animated"],
  noiseIds: [],
  buttonClassPattern: "^btn(-alt)?$",
  maxDepth: 3,
};

const BASE = { chrome: { header: "body > header", footer: "body > footer" }, roots: ["main"], viewport: 1280 };

let dir;
let server;
let baseUrl;
let browser;

const page = (name, body) => {
  const { html } = instrumentHtml(`<html><body>${body}</body></html>`, name);
  fs.writeFileSync(path.join(dir, `${name}.html`), html, "utf8");
};

before(async () => {
  dir = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "mig-seg-"));

  // A page whose sections come from two overlapping rules, plus a wrapper that
  // only exists after script runs.
  page(
    "overlap",
    `<main>
       <section class="internal">
         <div id="interior-banner"><h1>Kicker</h1><h2>Title</h2><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="200" height="120" style="width:200px;height:120px"></div>
         <div class="page-divider">
           <div class="block"><h2>One</h2><p>${"first block copy ".repeat(6)}</p></div>
           <div class="block"><h2>Two</h2><p>${"second block copy ".repeat(6)}</p></div>
         </div>
       </section>
     </main>`
  );

  // Sections whose document order is the reverse of the rule order.
  page(
    "ordering",
    `<main>
       <div class="top"><h2>Comes first</h2><p>${"top copy ".repeat(8)}</p></div>
       <div class="bottom"><h2>Comes second</h2><p>${"bottom copy ".repeat(8)}</p></div>
     </main>`
  );

  page(
    "chrome",
    `<header><nav><a href="/">Home</a></nav></header>
     <main><div class="body"><h2>Content</h2><p>${"copy ".repeat(10)}</p></div></main>
     <footer><p>Footer</p></footer>`
  );

  ({ server, url: baseUrl } = await serve(dir, 0));
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function segment(name, rules) {
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await p.goto(`${baseUrl}/${name}.html`, { waitUntil: "load" });
  const result = await segmentPage(p, { ...BASE, rules, normalizer: NORMALIZER });
  await p.close();
  return result;
}

describe("overlapping rules", () => {
  test("keeps the innermost section, not the wrapper containing it", async () => {
    // Covering a varied site takes several rules, and they overlap. Keeping the
    // outer match swallows the finer blocks inside it.
    const { sections } = await segment("overlap", [
      { id: "wrapper", mode: "element", selector: "section.internal", cutBefore: [], glue: [], minTextLength: 0 },
      { id: "blocks", mode: "element", selector: ".page-divider > .block", cutBefore: [], glue: [], minTextLength: 0 },
    ]);

    const classes = sections.map((s) => s.classes.join("."));
    assert.ok(!classes.includes("internal"), "the wrapper should be dropped");
    assert.equal(classes.filter((c) => c === "block").length, 2, "both inner blocks kept");
  });

  test("keeps a coarse container when nothing finer matched inside it", async () => {
    const { sections } = await segment("overlap", [
      { id: "wrapper", mode: "element", selector: "section.internal", cutBefore: [], glue: [], minTextLength: 0 },
    ]);
    assert.equal(sections.length, 1);
    assert.ok(sections[0].classes.includes("internal"));
  });
});

describe("section order", () => {
  test("follows the document, not the order the rules ran", async () => {
    // `mig content` sorts by `order`, so numbering by rule order emits a page's
    // sections in the wrong sequence.
    const { sections } = await segment("ordering", [
      { id: "second-rule", mode: "element", selector: ".bottom", cutBefore: [], glue: [], minTextLength: 0 },
      { id: "first-rule", mode: "element", selector: ".top", cutBefore: [], glue: [], minTextLength: 0 },
    ]);

    assert.equal(sections.length, 2);
    assert.match(sections[0].textPreview, /Comes first/);
    assert.match(sections[1].textPreview, /Comes second/);
    assert.deepEqual(sections.map((s) => s.order), [0, 1]);
  });
});

describe("identity", () => {
  test("anchors every section on a stamped element", async () => {
    const { sections } = await segment("overlap", [
      { id: "blocks", mode: "element", selector: ".page-divider > .block", cutBefore: [], glue: [], minTextLength: 0 },
    ]);

    for (const s of sections) {
      assert.ok(s.anchorUid, "a section with no stable id cannot be re-found later");
      assert.equal(typeof s.anchorLift, "number");
    }
    assert.equal(new Set(sections.map((s) => s.anchorUid)).size, sections.length);
  });

  test("records the structure and features used for clustering", async () => {
    const { sections } = await segment("overlap", [
      { id: "banner", mode: "element", selector: "#interior-banner", cutBefore: [], glue: [], minTextLength: 0 },
    ]);

    const [banner] = sections;
    assert.deepEqual(banner.roleSequence, ["H1", "H2", "IMG"]);
    assert.equal(banner.id, "interior-banner");
    assert.equal(banner.features.imageCount, "1");
  });
});

describe("chrome", () => {
  test("never treats the header or footer as page content", async () => {
    const { sections, chrome } = await segment("chrome", [
      { id: "any", mode: "element", selector: "div", cutBefore: [], glue: [], minTextLength: 0 },
    ]);

    const text = sections.map((s) => s.textPreview).join(" ");
    assert.doesNotMatch(text, /Footer/);
    assert.doesNotMatch(text, /Home/);
    assert.equal(chrome.length, 2, "header and footer are reported separately");
  });
});
