import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolveIcon, resolveItemIcons, normalizeIconName } from "../src/content/resolve-icon.mjs";

/** The source site's icon font, as `mig tokens` records it. */
const GLYPH_MAP = {
  family: "fontello",
  glyphs: {
    "icon-mail": "\\e800",
    "icon-facebook": "\\e805",
    "icon-ok-1": "\\e832",
    "icon-phone": "\\e80d",
    "icon-obscure-widget": "\\e9f1",
  },
};

/** A conventional icon set, as the target ships. */
const ICON_SET = new Set([
  "check",
  "check-circle",
  "envelope",
  "phone",
  "map-pin",
  "clock",
  "star",
  "user",
]);

describe("normalizeIconName", () => {
  test("strips the font prefix and variant suffix", () => {
    assert.equal(normalizeIconName("icon-ok-1"), "ok");
    assert.equal(normalizeIconName("icon-map-marker"), "map-marker");
    assert.equal(normalizeIconName("icon-phone"), "phone");
  });
});

describe("resolving an icon-font glyph", () => {
  test("translates a codepoint into a name the target can render", () => {
    // The real case: a why-choose list whose bullet is a fontello tick.
    const resolved = resolveIcon(
      { kind: "glyph", codepoint: "e832", family: "fontello" },
      { glyphMap: GLYPH_MAP, iconSet: ICON_SET }
    );

    assert.equal(resolved.type, "name");
    assert.equal(resolved.sourceName, "icon-ok-1");
    assert.equal(resolved.name, "check");
  });

  test("maps semantically rather than by string match", () => {
    const resolved = resolveIcon(
      { kind: "glyph", codepoint: "e800", family: "fontello" },
      { glyphMap: GLYPH_MAP, iconSet: ICON_SET }
    );
    assert.equal(resolved.name, "envelope", "`mail` and `envelope` are the same intent");
  });

  test("reports a glyph with no equivalent instead of inventing one", () => {
    const resolved = resolveIcon(
      { kind: "glyph", codepoint: "e9f1", family: "fontello" },
      { glyphMap: GLYPH_MAP, iconSet: ICON_SET }
    );
    assert.equal(resolved.type, "unresolved");
    assert.equal(resolved.sourceName, "icon-obscure-widget");
  });

  test("returns nothing for a codepoint the font does not define", () => {
    assert.equal(
      resolveIcon({ kind: "glyph", codepoint: "efff" }, { glyphMap: GLYPH_MAP, iconSet: ICON_SET }),
      null
    );
  });
});

describe("resolving other icon forms", () => {
  test("keeps a png or svg icon as an image", () => {
    const resolved = resolveIcon(
      { kind: "image", src: "/assets/images/tooth.svg", alt: "Tooth" },
      { glyphMap: GLYPH_MAP, iconSet: ICON_SET }
    );
    assert.deepEqual(resolved, { type: "image", src: "/assets/images/tooth.svg", alt: "Tooth" });
  });

  test("translates an explicit icon class", () => {
    const resolved = resolveIcon(
      { kind: "class", name: "icon-phone" },
      { glyphMap: GLYPH_MAP, iconSet: ICON_SET }
    );
    assert.equal(resolved.name, "phone");
  });

  test("handles a section with no icon at all", () => {
    assert.equal(resolveIcon(null, { glyphMap: GLYPH_MAP, iconSet: ICON_SET }), null);
  });
});

describe("resolving a list's icons", () => {
  test("writes iconName onto each item and clears the raw capture", () => {
    const items = [
      { text: "Financing available", icon: { kind: "glyph", codepoint: "e832" } },
      { text: "Evening appointments", icon: { kind: "glyph", codepoint: "e832" } },
    ];

    const result = resolveItemIcons(items, { glyphMap: GLYPH_MAP, iconSet: ICON_SET });

    assert.deepEqual(result.unresolved, []);
    assert.equal(items[0].iconName, "check");
    assert.equal(items[1].iconName, "check");
    assert.ok(!("icon" in items[0]), "the raw capture should not reach the frontmatter");
  });

  test("carries an image icon through as an image", () => {
    const items = [{ text: "A", icon: { kind: "image", src: "/i/a.svg", alt: "A" } }];
    resolveItemIcons(items, { glyphMap: GLYPH_MAP, iconSet: ICON_SET });
    assert.equal(items[0].iconImage, "/i/a.svg");
    assert.equal(items[0].iconAlt, "A");
  });

  test("reports untranslatable glyphs so they are not lost silently", () => {
    const items = [{ text: "A", icon: { kind: "glyph", codepoint: "e9f1" } }];
    const result = resolveItemIcons(items, { glyphMap: GLYPH_MAP, iconSet: ICON_SET });
    assert.deepEqual(result.unresolved, ["icon-obscure-widget"]);
    assert.ok(!items[0].iconName, "an unresolved icon must not be guessed at");
  });

  test("flags substitutions, so an approximation is not mistaken for a match", () => {
    const items = [{ text: "A", icon: { kind: "glyph", codepoint: "e832" } }];
    const result = resolveItemIcons(items, { glyphMap: GLYPH_MAP, iconSet: ICON_SET });
    assert.deepEqual(result.approximated, ["icon-ok-1 -> check"]);
  });

  test("leaves items without icons untouched", () => {
    const items = [{ text: "A" }];
    const result = resolveItemIcons(items, { glyphMap: GLYPH_MAP, iconSet: ICON_SET });
    assert.deepEqual(result.unresolved, []);
    assert.deepEqual(items, [{ text: "A" }]);
  });
});

describe("when the target ships the same icon font", () => {
  // The common case: the template already renders the source's icon font, so
  // the name carries across untouched and nothing is approximated.
  const FONTELLO_SET = new Set(Object.keys(GLYPH_MAP.glyphs));

  test("keeps the source's own icon name", () => {
    const resolved = resolveIcon(
      { kind: "glyph", codepoint: "e832", family: "fontello" },
      { glyphMap: GLYPH_MAP, iconSet: ICON_SET, fontelloSet: FONTELLO_SET }
    );

    assert.equal(resolved.name, "icon-ok-1", "no substitution is needed or wanted");
    assert.equal(resolved.exact, true);
  });

  test("records nothing as approximated", () => {
    const items = [{ text: "A", icon: { kind: "glyph", codepoint: "e832" } }];
    const result = resolveItemIcons(items, {
      glyphMap: GLYPH_MAP,
      iconSet: ICON_SET,
      fontelloSet: FONTELLO_SET,
    });

    assert.deepEqual(result.approximated, []);
    assert.equal(items[0].iconName, "icon-ok-1");
  });

  test("still substitutes for a glyph the target font lacks", () => {
    const partial = new Set(["icon-mail"]);
    const resolved = resolveIcon(
      { kind: "glyph", codepoint: "e832" },
      { glyphMap: GLYPH_MAP, iconSet: ICON_SET, fontelloSet: partial }
    );
    assert.equal(resolved.name, "check");
    assert.ok(!resolved.exact);
  });
});
