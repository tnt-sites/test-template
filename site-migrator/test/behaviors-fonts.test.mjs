import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { scanBehaviors, scanScripts, mapToProps } from "../src/behaviors/scan-js.mjs";
import {
  extractIconGlyphs,
  iconFontFamily,
  extractFontFaces,
  preferModernFormats,
  rewriteFontFaceUrls,
} from "../src/css/fonts.mjs";

const MIRROR =
  process.env.MIGRATOR_SOURCE_MIRROR ||
  "/Users/tharvey/Work/CloudCannon/taylor-street-dental/static";

describe("behaviour extraction", () => {
  test("recovers a carousel's options and the selector it applies to", () => {
    const { behaviors } = scanBehaviors(
      `$('.slick-reviews').slick({ dots: true, arrows: false, autoplaySpeed: 10000, draggable: false });`,
      ["slick"]
    );

    assert.equal(behaviors.length, 1);
    assert.equal(behaviors[0].selector, ".slick-reviews");
    assert.equal(behaviors[0].options.autoplaySpeed, 10000);
    assert.equal(behaviors[0].options.arrows, false);
    assert.equal(behaviors[0].options.draggable, false);
  });

  test("ignores calls that are not configured widget initialisers", () => {
    const { behaviors } = scanBehaviors(`$('.x').fadeIn({ duration: 100 });`, ["slick"]);
    assert.deepEqual(behaviors, []);
  });

  test("records non-literal option values rather than dropping the option", () => {
    const { behaviors } = scanBehaviors(
      `$('.x').slick({ customPaging: function(){}, dots: true });`,
      ["slick"]
    );
    assert.equal(behaviors[0].options.dots, true);
    assert.ok("customPaging" in behaviors[0].options, "an unreadable value is still reported");
  });

  test("survives nested responsive settings", () => {
    const { behaviors } = scanBehaviors(
      `$('.x').slick({ responsive: [{ breakpoint: 1000, settings: { fade: true } }] });`,
      ["slick"]
    );
    assert.equal(behaviors[0].options.responsive[0].breakpoint, 1000);
    assert.equal(behaviors[0].options.responsive[0].settings.fade, true);
  });

  test("reports a parse failure instead of throwing", () => {
    const { behaviors, error } = scanBehaviors("this is ( not javascript", ["slick"]);
    assert.deepEqual(behaviors, []);
    assert.match(error, /parse failed/);
  });

  test(
    "extracts the real carousel settings from the source site",
    { skip: !fs.existsSync(path.join(MIRROR, "assets/js/scripts.js")) },
    () => {
      const { behaviors, errors } = scanScripts(["assets/js/scripts.js"], {
        mirrorDir: MIRROR,
        pluginNames: ["slick"],
      });

      assert.deepEqual(errors, []);
      const reviews = behaviors.find((b) => b.selector === ".slick-reviews");
      assert.ok(reviews, "the reviews carousel should be found");

      // These are exactly the settings a markup-only migration loses.
      assert.equal(reviews.options.autoplaySpeed, 10000);
      assert.equal(reviews.options.arrows, false);
      assert.equal(reviews.options.draggable, false);
      assert.equal(reviews.options.autoplay, true);
    }
  );
});

describe("mapping behaviours onto component props", () => {
  const propMap = {
    autoplaySpeed: "autoplayDelay",
    autoplay: "autoPlay",
    arrows: "showArrows",
    draggable: "drag",
  };

  test("maps configured options", () => {
    const { props } = mapToProps(
      { options: { autoplaySpeed: 10000, autoplay: true } },
      propMap
    );
    assert.deepEqual(props, { autoplayDelay: 10000, autoPlay: true });
  });

  test("reports options the target component cannot express", () => {
    const { props, unmapped } = mapToProps(
      { options: { draggable: false, autoplaySpeed: 10000 } },
      propMap,
      ["autoplayDelay", "showArrows"] // the target has no `drag` prop
    );

    assert.deepEqual(props, { autoplayDelay: 10000 });
    assert.equal(unmapped.length, 1);
    assert.equal(unmapped[0].option, "draggable");
    assert.match(unmapped[0].reason, /no such prop/);
  });

  test("reports options with no mapping at all", () => {
    const { unmapped } = mapToProps({ options: { cssEase: "linear" } }, propMap);
    assert.equal(unmapped[0].option, "cssEase");
  });
});

describe("icon fonts", () => {
  const ICON_CSS = `
    @font-face {
      font-family: 'fontello';
      src: url('../font/fontello.eot?1') format('embedded-opentype'),
           url('../font/fontello.woff2?1') format('woff2'),
           url('../font/fontello.woff?1') format('woff'),
           url('../font/fontello.ttf?1') format('truetype');
      font-weight: normal;
      font-style: normal;
    }
    [class^="icon-"]:before, [class*=" icon-"]:before {
      font-family: "fontello";
      font-style: normal;
    }
    .icon-mail:before { content: '\\e800'; }
    .icon-facebook:before { content: '\\e805'; }
    .icon-ok-1:before { content: '\\e832'; }
    .not-an-icon { color: red; }
  `;

  test("builds a glyph map from the stylesheet", () => {
    const glyphs = extractIconGlyphs(ICON_CSS);
    assert.equal(glyphs["icon-mail"], "\\e800");
    assert.equal(glyphs["icon-facebook"], "\\e805");
    assert.equal(glyphs["icon-ok-1"], "\\e832");
  });

  test("ignores rules that are not glyph definitions", () => {
    const glyphs = extractIconGlyphs(ICON_CSS);
    assert.equal(Object.keys(glyphs).length, 3);
  });

  test("finds the family the icons render with", () => {
    assert.equal(iconFontFamily(ICON_CSS), "fontello");
  });

  test("prefers woff2 over legacy formats", () => {
    const faces = extractFontFaces(ICON_CSS, "https://example.com/css/icons.css");
    assert.equal(faces.length, 1);
    assert.equal(faces[0].sources.length, 4);

    const modern = preferModernFormats(faces[0].sources);
    assert.equal(modern.length, 1);
    assert.match(modern[0].url, /fontello\.woff2/);
    assert.equal(
      modern[0].url,
      "https://example.com/font/fontello.woff2?1",
      "relative src must resolve against the stylesheet, not the page"
    );
  });

  test("rewrites font URLs to the rehosted copies", () => {
    const faces = extractFontFaces(ICON_CSS, "https://example.com/css/icons.css");
    const urlMap = new Map([
      ["https://example.com/font/fontello.woff2?1", "/fonts/fontello.woff2"],
    ]);
    const rewritten = rewriteFontFaceUrls(faces[0].css, urlMap, "https://example.com/css/icons.css");
    assert.match(rewritten, /\/fonts\/fontello\.woff2/);
  });

  test(
    "the real source icon font covers at least as many icons as were hand-built",
    { skip: !process.env.MIGRATOR_ALLOW_NETWORK },
    async () => {
      const css = await (
        await fetch("https://tntwebsites.com/tnticons/css/fontello.css")
      ).text();
      assert.ok(Object.keys(extractIconGlyphs(css)).length >= 76);
    }
  );
});
