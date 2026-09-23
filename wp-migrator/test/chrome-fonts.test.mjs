import assert from "node:assert/strict";
import test from "node:test";
import { loadedFamilies, resolveFamily, reconcileFonts } from "../src/chrome/fonts.mjs";

const branding = {
  fontLinks: [
    "https://fonts.googleapis.com/css2?family=Lato:wght@400;700&family=Playfair+Display:ital,wght@0,400..900&display=swap",
  ],
  bodyFont: { fontFamily: '"Lato", sans-serif' },
};

test("families are read from the target's own font links", () => {
  assert.deepEqual(loadedFamilies(branding).sort(), ["Lato", "Playfair Display"]);
});

test("a measured family resolves to the loaded relative that carries it", () => {
  // The source names "Playfair"; the target loads "Playfair Display". Emitted
  // verbatim the token resolves to nothing and the browser falls back.
  assert.equal(resolveFamily("Playfair", loadedFamilies(branding)), "Playfair Display");
  assert.equal(resolveFamily("Lato", loadedFamilies(branding)), "Lato");
});

test("an unrelated family is left alone rather than replaced", () => {
  assert.equal(resolveFamily("Georgia", loadedFamilies(branding)), null);
});

test("reconcileFonts rewrites the token and reports what it did", () => {
  const css = ':root {\n  --chrome-footer-heading-font: "Playfair", sans-serif;\n  --chrome-topbar-font: "Lato", sans-serif;\n}';
  const out = reconcileFonts(css, branding);

  assert.match(out.css, /--chrome-footer-heading-font: "Playfair Display", sans-serif;/);
  assert.match(out.css, /--chrome-topbar-font: "Lato", sans-serif;/);
  assert.deepEqual(out.swapped, [{ from: "Playfair", to: "Playfair Display" }]);
  assert.deepEqual(out.missing, []);
});

test("a family with no relative anywhere is reported, not silently dropped", () => {
  const out = reconcileFonts(':root {\n  --chrome-nav-link-font: "Futura", sans-serif;\n}', branding);
  assert.match(out.css, /"Futura"/);
  assert.deepEqual(out.missing, ["Futura"]);
});
