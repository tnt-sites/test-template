import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";
import safeParser from "postcss-safe-parser";
import {
  detectRootFontSize,
  normalizeRemInValue,
  normalizeRoot,
  assertNoRootFontSize,
  lengthToPx,
} from "../src/css/units.mjs";

const MIRROR =
  process.env.MIGRATOR_SOURCE_MIRROR ||
  "/Users/tharvey/Work/CloudCannon/taylor-street-dental/static";

describe("root font-size detection", () => {
  test("finds a 10px root written with spaces", () => {
    assert.equal(detectRootFontSize(["html { font-size: 10px;}"]), 10);
  });

  test("finds a minified 10px root", () => {
    assert.equal(detectRootFontSize(["html{font-size:10px}"]), 10);
  });

  test("resolves percentages", () => {
    assert.equal(detectRootFontSize(["html { font-size: 62.5%; }"]), 10);
    assert.equal(detectRootFontSize(["html { font-size: 100%; }"]), 16);
  });

  test("later sheets win, matching the cascade", () => {
    // This is the real-world case: a reset sets 100%, the theme then sets 10px.
    const sheets = [
      { css: "html{font-family:sans-serif; font-size: 100%}" },
      { css: '@charset "UTF-8";html { font-size: 10px;}body{color:#626262}' },
    ];
    assert.equal(
      detectRootFontSize(sheets),
      10,
      "a reset earlier in the cascade must not mask the theme's root size"
    );
  });

  test("returns null when no root size is declared", () => {
    assert.equal(detectRootFontSize(["body { color: red }"]), null);
  });

  test("matches the real source site", { skip: !fs.existsSync(path.join(MIRROR, "styles.css")) }, () => {
    const sheets = ["_ui.css", "styles.css"].map((f) => ({
      css: fs.readFileSync(path.join(MIRROR, f), "utf8"),
    }));
    assert.equal(detectRootFontSize(sheets), 10);
  });
});

describe("rem normalisation", () => {
  test("converts rem to px at the detected root size", () => {
    assert.equal(normalizeRemInValue("1.6rem", 10), "16px");
    assert.equal(normalizeRemInValue("400 1.6rem/1.666 montserrat", 10), "400 16px/1.666 montserrat");
  });

  test("leaves values alone when the root is already 16px", () => {
    assert.equal(normalizeRemInValue("1.6rem", 16), "1.6rem");
  });

  test("leaves px and em untouched", () => {
    assert.equal(normalizeRemInValue("10px 2em", 10), "10px 2em");
  });

  test("handles negative values", () => {
    assert.equal(normalizeRemInValue("-2rem", 10), "-20px");
  });

  test("drops the source root rule instead of porting it", () => {
    const root = postcss.parse("html { font-size: 10px } p { font-size: 1.6rem }", {
      parser: safeParser,
    });
    const stats = normalizeRoot(root, 10);

    assert.equal(stats.dropped, 1);
    assert.equal(stats.converted, 1);
    assert.doesNotMatch(root.toString(), /html/, "the root rule must not survive the port");
    assert.match(root.toString(), /font-size: 16px/);
  });

  test("does not rewrite content strings", () => {
    const root = postcss.parse('.i:before { content: "\\e832"; font-size: 1.6rem }', {
      parser: safeParser,
    });
    normalizeRoot(root, 10);
    assert.match(root.toString(), /content: "\\e832"/);
    assert.match(root.toString(), /font-size: 16px/);
  });
});

describe("root font-size guard", () => {
  test("rejects emitted CSS that would rescale the whole template", () => {
    assert.throws(
      () => assertNoRootFontSize("html { font-size: 10px }"),
      /rescales the whole target template/
    );
    assert.throws(() => assertNoRootFontSize(":root { font-size: 62.5% }"), /rescales/);
  });

  test("allows CSS with no root font-size", () => {
    assert.doesNotThrow(() => assertNoRootFontSize(":root { --color-bg: #fff }"));
    assert.doesNotThrow(() => assertNoRootFontSize("p { font-size: 16px }"));
  });
});

describe("lengthToPx", () => {
  test("converts the units that appear in real stylesheets", () => {
    assert.equal(lengthToPx("10px"), 10);
    assert.equal(lengthToPx("1.6rem", 10), 16);
    assert.equal(lengthToPx("62.5%"), 10);
    assert.equal(lengthToPx("12pt"), 16);
    assert.equal(lengthToPx("auto"), null);
  });
});
