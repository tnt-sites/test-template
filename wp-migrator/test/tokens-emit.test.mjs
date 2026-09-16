import assert from "node:assert/strict";
import test from "node:test";
import { emitSemanticOverrides } from "../src/css/tokens/emit.mjs";

const artifact = (over = {}) => ({
  roles: { text: "#000000", bgPage: "#ffffff" },
  extras: [],
  rootFontSizePx: 16,
  ...over,
});

test("a source body size that differs from the root is written as a token", () => {
  // The bug this pins: the size was measured and then dropped, so every
  // migrated page inherited the starter's 1rem and every paragraph reflowed
  // taller than the source's.
  const css = emitSemanticOverrides(artifact({ measured: { paragraph: { "font-size": "18px" } } }));

  assert.match(css, /--font-size-md: 1\.125rem;/);
});

test("a body size equal to the root writes nothing", () => {
  const css = emitSemanticOverrides(artifact({ measured: { paragraph: { "font-size": "16px" } } }));

  assert.equal(/--font-size-md/.test(css), false);
});

test("rem is computed against the source's own root, not a presumed 16", () => {
  // `html { font-size: 62.5% }` is a common theme idiom; dividing by 16 there
  // would emit a base several times too large.
  const css = emitSemanticOverrides(
    artifact({ rootFontSizePx: 10, measured: { paragraph: { "font-size": "18px" } } })
  );

  assert.match(css, /--font-size-md: 1\.8rem;/);
});

test("paragraph wins over body, which is only the fallback", () => {
  const css = emitSemanticOverrides(
    artifact({ measured: { body: { "font-size": "14px" }, paragraph: { "font-size": "18px" } } })
  );

  assert.match(css, /--font-size-md: 1\.125rem;/);
});

test("a relative measurement is ignored rather than used to define its own base", () => {
  const css = emitSemanticOverrides(
    artifact({ measured: { paragraph: { "font-size": "1.2em" } } })
  );

  assert.equal(/--font-size-md/.test(css), false);
});

test("no measurement at all still emits the colour tokens", () => {
  const css = emitSemanticOverrides(artifact());

  assert.match(css, /--color-text: #000000;/);
  assert.equal(/--font-size-md/.test(css), false);
});
