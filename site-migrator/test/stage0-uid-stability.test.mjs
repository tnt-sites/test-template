import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { instrumentHtml, sliceByUid, UID_ATTR } from "../src/mirror/instrument.mjs";
import { serve } from "../src/mirror/serve.mjs";

/**
 * Stage 0 acceptance: a uid stamped into the raw HTML must survive the source
 * site's own runtime DOM restructuring.
 *
 * This is the assumption the entire pipeline rests on. The source rewrites its
 * DOM with jQuery on load — wrapping flow content in `.block`, moving
 * `#main-img` into `#interior-banner`, adding index-derived `elem-left` /
 * `elem-right` classes. If uids did not ride along with moved nodes, every
 * later stage would misidentify sections exactly the way the previous toolkit
 * did.
 */

const MIRROR =
  process.env.MIGRATOR_SOURCE_MIRROR ||
  "/Users/tharvey/Work/CloudCannon/taylor-street-dental/static";

const available = fs.existsSync(path.join(MIRROR, "index.html"));

describe("instrumentHtml", () => {
  test("stamps every element with a unique, document-ordered uid", () => {
    const { html, count, uids } = instrumentHtml(
      "<html><body><div><p>a</p><p>b</p></div></body></html>",
      "t"
    );
    assert.equal(new Set(uids).size, uids.length, "uids must be unique");
    assert.ok(count >= 4, `expected body/div/p/p, got ${count}`);
    assert.match(html, /data-mig-uid="t:0000"/);
  });

  test("is stable across re-instrumentation", () => {
    const once = instrumentHtml("<html><body><div><p>a</p></div></body></html>", "t");
    const twice = instrumentHtml(once.html, "t");
    assert.deepEqual(twice.uids, once.uids, "re-running must not renumber");
    assert.equal(twice.html, once.html);
  });

  test("does not stamp elements where it would change rendering", () => {
    const { html } = instrumentHtml(
      "<html><head><title>t</title></head><body><script>var x=1</script><br></body></html>",
      "t"
    );
    assert.doesNotMatch(html, /<title data-mig-uid/);
    assert.doesNotMatch(html, /<script data-mig-uid/);
    assert.doesNotMatch(html, /<br data-mig-uid/);
  });

  test("recovers a raw subtree by uid", () => {
    const { html } = instrumentHtml(
      "<html><body><section class='hero'><h2>Hi</h2></section></body></html>",
      "t"
    );
    const uid = html.match(/<section [^>]*data-mig-uid="([^"]+)"/)[1];
    const slice = sliceByUid(html, uid);
    assert.match(slice, /<h2[^>]*>Hi<\/h2>/);
    assert.match(slice, /class="hero"/);
  });
});

describe("uid survives the source site's runtime DOM restructuring", { skip: !available }, () => {
  let dir;
  let server;
  let baseUrl;
  let browser;

  before(async () => {
    // Build a throwaway instrumented mirror alongside the source assets.
    dir = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "mig-uid-"));
    for (const entry of fs.readdirSync(MIRROR, { withFileTypes: true })) {
      const from = path.join(MIRROR, entry.name);
      const to = path.join(dir, entry.name);
      if (entry.isDirectory()) fs.cpSync(from, to, { recursive: true });
      else if (/\.html?$/i.test(entry.name)) {
        const { html } = instrumentHtml(fs.readFileSync(from, "utf8"), entry.name.replace(/\..*$/, ""));
        fs.writeFileSync(to, html, "utf8");
      } else fs.copyFileSync(from, to);
    }

    ({ server, url: baseUrl } = await serve(dir, 0));
    browser = await chromium.launch();
  });

  after(async () => {
    await browser?.close();
    server?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("#main-img keeps its uid after jQuery moves it into #interior-banner", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${baseUrl}/veneers.html`, { waitUntil: "networkidle" });

    // Its uid in the raw document, before any JS ran.
    const raw = fs.readFileSync(path.join(dir, "veneers.html"), "utf8");
    const rawUid = raw.match(/id="main-img"[^>]*data-mig-uid="([^"]+)"/)?.[1]
      ?? raw.match(/data-mig-uid="([^"]+)"[^>]*id="main-img"/)?.[1];
    assert.ok(rawUid, "#main-img should exist and be stamped in the raw HTML");

    const after = await page.evaluate(() => {
      const el = document.querySelector("#main-img");
      if (!el) return null;
      return {
        uid: el.getAttribute("data-mig-uid"),
        parentId: el.parentElement?.id ?? null,
        parentClass: el.parentElement?.className ?? null,
      };
    });

    assert.ok(after, "#main-img should still exist after JS runs");
    assert.equal(after.uid, rawUid, "uid must ride along with the moved node");
    await page.close();
  });

  test("JS-injected wrappers are absent from raw HTML but present after load", async () => {
    const raw = fs.readFileSync(path.join(dir, "veneers.html"), "utf8");
    assert.equal(
      /class="[^"]*\bblock\b/.test(raw),
      false,
      "`.block` must not exist in raw HTML — it is injected by scripts.js"
    );

    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${baseUrl}/veneers.html`, { waitUntil: "networkidle" });
    const counts = await page.evaluate(() => ({
      block: document.querySelectorAll(".block").length,
      dividerLead: document.querySelectorAll(".dividerLead").length,
      elemSided: document.querySelectorAll(".elem-left, .elem-right").length,
    }));

    assert.ok(counts.block > 0, "scripts.js should have created .block wrappers");
    assert.ok(counts.dividerLead > 0, "scripts.js should have created .dividerLead");
    await page.close();
  });

  test("every element found after load can be re-found by its uid", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${baseUrl}/veneers.html`, { waitUntil: "networkidle" });

    const result = await page.evaluate((attr) => {
      const withUid = [...document.querySelectorAll(`[${attr}]`)];
      const uids = withUid.map((e) => e.getAttribute(attr));
      const unique = new Set(uids);
      // Every uid must resolve back to exactly one element.
      const unresolvable = uids.filter(
        (u) => document.querySelectorAll(`[${attr}="${u}"]`).length !== 1
      );
      return { total: withUid.length, unique: unique.size, unresolvable: unresolvable.length };
    }, UID_ATTR);

    assert.ok(result.total > 100, `expected a populated page, saw ${result.total} stamped elements`);
    assert.equal(result.unique, result.total, "uids must stay unique after JS runs");
    assert.equal(result.unresolvable, 0, "every uid must resolve to exactly one element");
    await page.close();
  });

  test("elem-left/elem-right alternate by index — identity must not depend on them", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${baseUrl}/veneers.html`, { waitUntil: "networkidle" });

    const sides = await page.evaluate(() =>
      [...document.querySelectorAll(".block")].map((b) =>
        b.querySelector(".elem-left") ? "left" : b.querySelector(".elem-right") ? "right" : "none"
      )
    );

    const sided = sides.filter((s) => s !== "none");
    if (sided.length >= 2) {
      assert.ok(
        new Set(sided).size > 1,
        "expected alternating sides — this is why imageSide must be a prop, not identity"
      );
    }
    await page.close();
  });
});

describe("mirror server", () => {
  test("refuses path traversal", async () => {
    const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "mig-serve-"));
    fs.writeFileSync(path.join(dir, "ok.html"), "<p>ok</p>");
    const { server, url } = await serve(dir, 0);

    const good = await fetch(`${url}/ok.html`);
    assert.equal(good.status, 200);

    const bad = await fetch(`${url}/../../../../etc/passwd`);
    assert.equal(bad.status, 404, "must not serve files outside the mirror root");

    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
