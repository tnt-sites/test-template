import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { emitChromeStyles } from "../src/chrome/styles.mjs";

const TARGETS = {
  headerBar: ".main-nav .bar",
  navLink: ".main-nav nav > ul > li > a",
  footerBackground: "footer",
};

const PALETTE = {
  "--color-brand": "#134545",
  "--color-bg": "#f4f1ec",
  "--src-color1": "#d0c8b7",
};

describe("porting chrome styling", () => {
  test("emits the source's colours and type against the template's selectors", () => {
    const css = emitChromeStyles(
      {
        navLink: {
          color: "rgb(0, 0, 0)",
          "font-family": "montserrat, sans-serif",
          "font-size": "16px",
          "font-weight": "500",
        },
      },
      { targetSelectors: TARGETS, palette: PALETTE }
    );

    assert.match(css, /\.main-nav nav > ul > li > a \{/);
    assert.match(css, /font-family: montserrat, sans-serif;/);
    assert.match(css, /font-weight: 500;/);
    assert.match(css, /@layer source-bridge \{/);
  });

  test("rewrites a colour in the palette to a token with a literal fallback", () => {
    // The chrome then follows a branding change, and still renders correctly
    // if the variable is ever unset.
    const css = emitChromeStyles(
      { headerBar: { "background-color": "rgb(208, 200, 183)" } },
      { targetSelectors: TARGETS, palette: PALETTE }
    );
    assert.match(css, /background-color: var\(--src-color1, #d0c8b7\);/);
  });

  test("leaves a colour outside the palette as a literal", () => {
    const css = emitChromeStyles(
      { headerBar: { "background-color": "rgb(1, 2, 3)" } },
      { targetSelectors: TARGETS, palette: PALETTE }
    );
    assert.match(css, /background-color: #010203;/);
  });

  test("keeps black text rather than treating it as an unset default", () => {
    // Black is the CSS initial value but also a real choice, and the template's
    // own text colour is not black.
    const css = emitChromeStyles(
      { navLink: { color: "rgb(0, 0, 0)" } },
      { targetSelectors: TARGETS, palette: PALETTE }
    );
    assert.match(css, /color: #000000;/);
  });

  test("drops a border colour that has no width to draw it", () => {
    const css = emitChromeStyles(
      {
        navLink: {
          color: "rgb(0, 0, 0)",
          "border-top-color": "rgb(0, 0, 0)",
          "border-top-width": "0px",
        },
      },
      { targetSelectors: TARGETS, palette: PALETTE }
    );
    assert.doesNotMatch(css, /border-top-color/);
  });

  test("keeps a border colour that is actually drawn", () => {
    const css = emitChromeStyles(
      {
        navLink: { "border-bottom-color": "rgb(19, 69, 69)", "border-bottom-width": "2px" },
      },
      { targetSelectors: TARGETS, palette: PALETTE }
    );
    assert.match(css, /border-bottom-color: var\(--color-brand, #134545\);/);
    assert.match(css, /border-bottom-width: 2px;/);
  });

  test("skips inert values", () => {
    const css = emitChromeStyles(
      {
        navLink: {
          color: "rgb(0, 0, 0)",
          "background-color": "rgba(0, 0, 0, 0)",
          "letter-spacing": "normal",
          "text-transform": "none",
        },
      },
      { targetSelectors: TARGETS, palette: PALETTE }
    );
    assert.doesNotMatch(css, /background-color/);
    assert.doesNotMatch(css, /letter-spacing/);
    assert.doesNotMatch(css, /text-transform/);
  });

  test("ignores a measured role the template has no home for", () => {
    const css = emitChromeStyles(
      { somethingUnknown: { color: "red" } },
      { targetSelectors: TARGETS, palette: PALETTE }
    );
    assert.equal(css, null);
  });

  test("returns nothing when there is nothing worth porting", () => {
    assert.equal(emitChromeStyles({}, { targetSelectors: TARGETS }), null);
  });
});

describe("background images referenced only by CSS", () => {
  test("finds the assets a measured style set references", async () => {
    const { assetsIn } = await import("../src/chrome/styles.mjs");
    const refs = assetsIn({
      footerBackground: {
        "background-image": 'url("http://127.0.0.1:8080/assets/images/footer-bg.svg")',
      },
      headerBackground: { "background-image": "none" },
    });
    assert.deepEqual(refs, ["assets/images/footer-bg.svg"]);
  });

  test("points a ported url at the rehosted copy", async () => {
    const { rewriteUrls } = await import("../src/chrome/styles.mjs");
    const map = new Map([["assets/images/footer-bg.svg", "/assets/images/footer-bg.svg"]]);

    // The computed value carries whatever host the mirror was served from,
    // which resolves to nothing once the migration is deployed.
    const out = rewriteUrls('url("http://127.0.0.1:8080/assets/images/footer-bg.svg")', map);
    assert.equal(out, 'url("/assets/images/footer-bg.svg")');
  });

  test("leaves an unmapped url alone rather than guessing", async () => {
    const { rewriteUrls } = await import("../src/chrome/styles.mjs");
    const original = 'url("https://cdn.example.com/x.png")';
    assert.equal(rewriteUrls(original, new Map()), original);
  });

  test("emits the background image alongside its position and repeat", () => {
    const css = emitChromeStyles(
      {
        footerBackground: {
          "background-color": "rgb(208, 200, 183)",
          "background-image": 'url("http://x/assets/bg.svg")',
          "background-repeat": "no-repeat",
          "background-position": "60% 0px",
          "background-size": "auto",
        },
      },
      {
        targetSelectors: { footerBackground: "footer" },
        palette: PALETTE,
        assetMap: new Map([["assets/bg.svg", "/assets/bg.svg"]]),
      }
    );

    assert.match(css, /background-image: url\("\/assets\/bg\.svg"\);/);
    assert.match(css, /background-repeat: no-repeat;/);
    assert.match(css, /background-position: 60% 0px;/);
    // `auto` is the initial value and carries no information.
    assert.doesNotMatch(css, /background-size/);
  });
});
