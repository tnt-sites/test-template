import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { extractChrome } from "../src/chrome/extract.mjs";
import { evaluateLabelIssues } from "../src/qa/chrome.mjs";

/**
 * Reading the navigation tree out of a source header.
 *
 * The menu is the one part of the chrome a reviewer is least likely to check
 * character by character — it renders, it is roughly the right shape, and the
 * labels are plausible. So the shapes that broke it once are pinned here.
 */

const CHROME = { header: "body > header", footer: "body > footer" };

let browser;
let page;

before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});

after(async () => {
  await browser?.close();
});

const read = async (body) => {
  await page.setContent(`<html><body>${body}</body></html>`);
  const result = await extractChrome(page, { chrome: CHROME, buttonClassPattern: "^btn$" });
  return result.header?.nav ?? [];
};

describe("navigation extraction", () => {
  test("reads a plain anchor menu", async () => {
    const nav = await read(`
      <header><nav><ul>
        <li><a href="/">Home</a></li>
        <li><a href="/contact.html">Contact</a></li>
      </ul></nav></header>
    `);

    assert.deepEqual(
      nav.map((item) => [item.name, item.path]),
      [
        ["Home", "/"],
        ["Contact", "/contact.html"],
      ]
    );
  });

  test("keeps a dropdown parent's own label and nests its children", async () => {
    const nav = await read(`
      <header><nav><ul>
        <li><a href="/about.html">About Us</a>
          <ul>
            <li><a href="/about.html">What Sets Us Apart</a></li>
            <li><a href="/team.html">Meet the Team</a></li>
          </ul>
        </li>
      </ul></nav></header>
    `);

    assert.equal(nav.length, 1);
    assert.equal(nav[0].name, "About Us");
    assert.deepEqual(
      nav[0].children.map((child) => child.name),
      ["What Sets Us Apart", "Meet the Team"]
    );
  });

  /*
   * The regression this file exists for.
   *
   * Menu scripts commonly replace a dropdown parent's <a> with a <span> or
   * <button> once the menu becomes interactive — the parent is a toggle, not a
   * link. Reading "the first anchor in this <li>" then reaches into the
   * sub-menu and returns the first child, so the parent migrates under its
   * child's name. It is invisible in a screenshot: the menu still has the
   * right number of items in the right order, just renamed.
   */
  test("a parent whose anchor the menu script replaced keeps its own label", async () => {
    const nav = await read(`
      <header><nav><ul>
        <li class="has-submenu"><span class="nav-parent">About Us</span>
          <ul>
            <li><a href="/about.html">What Sets Us Apart</a></li>
            <li><a href="/team.html">Meet the Team</a></li>
          </ul>
        </li>
        <li class="has-submenu"><button type="button">For Patients</button>
          <ul><li><a href="/first-visit.html">Your First Visit</a></li></ul>
        </li>
      </ul></nav></header>
    `);

    assert.deepEqual(
      nav.map((item) => item.name),
      ["About Us", "For Patients"]
    );
    assert.deepEqual(
      nav[0].children.map((child) => child.name),
      ["What Sets Us Apart", "Meet the Team"]
    );
  });

  test("a linkless parent still borrows a path from its first child", async () => {
    // The parent is a toggle with no href of its own, but a dropdown almost
    // always fronts the same landing page as its first entry, so the path is
    // worth keeping even though the label is not.
    const nav = await read(`
      <header><nav><ul>
        <li><span class="nav-parent">Office Info</span>
          <ul><li><a href="/contact.html">Contact</a></li></ul>
        </li>
      </ul></nav></header>
    `);

    assert.equal(nav[0].name, "Office Info");
    assert.equal(nav[0].path, "/contact.html");
  });

  test("skips items that carry neither a label nor a link", async () => {
    const nav = await read(`
      <header><nav><ul>
        <li><a href="/">Home</a></li>
        <li><span></span></li>
      </ul></nav></header>
    `);

    assert.deepEqual(
      nav.map((item) => item.name),
      ["Home"]
    );
  });
});

describe("form label accessibility", () => {
  // The real one: `Bar.astro`'s desktop submenu trigger — a `<label
  // role="button">` wrapping only an `aria-hidden` chevron icon, no
  // `aria-label`. It renders as a blank box to a screen reader.
  test("catches a label with no accessible name", async () => {
    await page.setContent(`<html><body>
      <label for="dropdown-1" role="button" tabindex="0">
        <span class="icon" aria-hidden="true">›</span>
      </label>
      <input type="checkbox" id="dropdown-1" />
    </body></html>`);

    const issues = await evaluateLabelIssues(page);

    assert.deepEqual(
      issues.map((i) => i.type),
      ["empty-label"]
    );
  });

  test("an aria-label rescues an otherwise-empty label", async () => {
    await page.setContent(`<html><body>
      <label for="dropdown-1" role="button" aria-label="Toggle About Us submenu" tabindex="0">
        <span class="icon" aria-hidden="true">›</span>
      </label>
      <input type="checkbox" id="dropdown-1" />
    </body></html>`);

    assert.deepEqual(await evaluateLabelIssues(page), []);
  });

  test("a bare label with visible text is left alone", async () => {
    await page.setContent(`<html><body>
      <label for="name">Name</label>
      <input type="text" id="name" />
    </body></html>`);

    assert.deepEqual(await evaluateLabelIssues(page), []);
  });

  // The real one: `Mobile.astro`'s hamburger and close buttons were both
  // `<label for="mobile-toggle-…">`, so the one checkbox had two names.
  test("catches a control with two labels pointing at it", async () => {
    await page.setContent(`<html><body>
      <input type="checkbox" id="mobile-toggle" />
      <label for="mobile-toggle" aria-label="Toggle navigation menu">Open</label>
      <label for="mobile-toggle" aria-label="Close navigation menu">Close</label>
    </body></html>`);

    const issues = await evaluateLabelIssues(page);

    assert.deepEqual(
      issues.map((i) => [i.type, i.count]),
      [["multiple-labels", 2]]
    );
  });

  test("one label per control is fine", async () => {
    await page.setContent(`<html><body>
      <input type="checkbox" id="mobile-toggle" />
      <label for="mobile-toggle" aria-label="Toggle navigation menu">Open</label>
      <label role="button" aria-label="Close navigation menu">Close</label>
    </body></html>`);

    assert.deepEqual(await evaluateLabelIssues(page), []);
  });
});
