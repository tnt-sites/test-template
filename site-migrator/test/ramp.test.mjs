import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { differenceEuclidean, converter } from "culori";
import { retintRamp, parseRamp, emitRamp, toOklch } from "../src/css/tokens/ramp.mjs";

const dE = differenceEuclidean("oklch");
const toOklab = converter("oklab");

/**
 * Ground truth: the template's stock neutral ramp, and the same ramp after a
 * human retinted it by hand for a source site whose body background is the
 * cream `#f4f1ec`. If the generator reproduces the hand work, it can replace it.
 */
const TEMPLATE_RAMP = [
  "#ffffff", "#eaeaea", "#d4d4d4", "#bfbfbf", "#aaaaaa", "#949494", "#7f7f7f",
  "#6a6a6a", "#555555", "#404040", "#2a2a2a", "#151515", "#000000",
];

const HAND_RETINTED = [
  "#f4f1ec", "#e0ddd8", "#cbc9c5", "#b7b5b1", "#a3a19d", "#8e8d8a", "#7a7976",
  "#666462", "#51504f", "#3d3c3b", "#292827", "#141414", "#000000",
];

const ANCHOR = "#f4f1ec";
const TOLERANCE = 0.02;

describe("gray ramp auto-retint", () => {
  test("reproduces a hand-retinted ramp within dE 0.02 at every stop", () => {
    const generated = retintRamp(ANCHOR, TEMPLATE_RAMP);

    assert.equal(generated.length, HAND_RETINTED.length);

    const deltas = generated.map((hex, i) => ({
      stop: i,
      generated: hex,
      hand: HAND_RETINTED[i],
      delta: dE(toOklch(hex), toOklch(HAND_RETINTED[i])),
    }));

    const failures = deltas.filter((d) => d.delta > TOLERANCE);
    assert.deepEqual(
      failures,
      [],
      `stops exceeded dE ${TOLERANCE}:\n` +
        failures.map((f) => `  gray-${f.stop}: ${f.generated} vs ${f.hand} (dE ${f.delta.toFixed(4)})`).join("\n")
    );

    const worst = Math.max(...deltas.map((d) => d.delta));
    assert.ok(worst < 0.01, `worst-case dE should be comfortably inside tolerance, got ${worst.toFixed(4)}`);
  });

  test("pins the lightest stop to the measured anchor exactly", () => {
    const generated = retintRamp(ANCHOR, TEMPLATE_RAMP);
    assert.equal(generated[0], ANCHOR, "gray-0 is the most visible surface — it must be exact");
  });

  test("keeps a pure-black endpoint pure black", () => {
    const generated = retintRamp(ANCHOR, TEMPLATE_RAMP);
    assert.equal(generated.at(-1), "#000000");
  });

  test("is a no-op for an achromatic anchor", () => {
    const generated = retintRamp("#ffffff", TEMPLATE_RAMP);
    for (let i = 0; i < TEMPLATE_RAMP.length; i++) {
      assert.ok(
        dE(toOklch(generated[i]), toOklch(TEMPLATE_RAMP[i])) < 0.01,
        `stop ${i} drifted for a neutral anchor: ${generated[i]} vs ${TEMPLATE_RAMP[i]}`
      );
    }
  });

  // Output is 8-bit hex. At the very low chroma of a tinted neutral, one
  // rounding step swings hue by several degrees, so hue-in-isolation is not a
  // meaningful assertion here — the invariant that matters is that every stop
  // is tinted in the *same chromatic direction* as the anchor, which is
  // quantization-robust.
  test("tints the whole scale in the anchor's chromatic direction", () => {
    for (const anchor of ["#eaf2ff", "#f4f1ec", "#f7eef2"]) {
      const generated = retintRamp(anchor, TEMPLATE_RAMP);
      const target = toOklab(anchor);

      for (let i = 1; i < generated.length - 1; i++) {
        const stop = toOklab(generated[i]);
        for (const axis of ["a", "b"]) {
          // Below roughly one 8-bit step the sign is rounding noise, not tint —
          // on either side of the comparison.
          const NOISE_FLOOR = 0.002;
          if (Math.abs(target[axis]) < NOISE_FLOOR) continue;
          if (Math.abs(stop[axis]) < NOISE_FLOOR) continue;
          assert.ok(
            Math.sign(stop[axis]) === Math.sign(target[axis]),
            `${anchor} stop ${i}: ${axis} axis ${stop[axis].toFixed(4)} should share the anchor's sign (${target[axis].toFixed(4)})`
          );
        }
      }
    }
  });

  test("chroma decreases toward black", () => {
    const generated = retintRamp(ANCHOR, TEMPLATE_RAMP);
    const chromas = generated.map((h) => toOklch(h).c ?? 0);

    for (let i = 1; i < chromas.length; i++) {
      assert.ok(
        chromas[i] <= chromas[i - 1] + 0.001,
        `chroma should not increase toward black (stop ${i}: ${chromas[i]} > ${chromas[i - 1]})`
      );
    }
    assert.ok(
      chromas.at(-1) < chromas[0],
      "the dark end must be less saturated than the light end"
    );
  });

  test("lightness decreases monotonically", () => {
    const generated = retintRamp(ANCHOR, TEMPLATE_RAMP);
    const ls = generated.map((h) => toOklch(h).l ?? 0);
    for (let i = 1; i < ls.length; i++) {
      assert.ok(ls[i] < ls[i - 1], `lightness must be strictly descending (stop ${i})`);
    }
  });

  test("rejects an unparseable anchor rather than emitting garbage", () => {
    assert.throws(() => retintRamp("not-a-color", TEMPLATE_RAMP), /Unparseable/);
  });
});

describe("ramp parse and emit", () => {
  test("parses a ramp out of a stylesheet", () => {
    const css = `:where(:root) {
  --gray-0: #ffffff;
  --gray-1: #eaeaea;
  --gray-2: #d4d4d4;
  --blue-dark: #3b82f6;
}`;
    assert.deepEqual(parseRamp(css), ["#ffffff", "#eaeaea", "#d4d4d4"]);
  });

  test("emits an unlayered override rather than editing the original", () => {
    const out = emitRamp(["#f4f1ec", "#e0ddd8"]);
    assert.match(out, /:where\(:root\)/);
    assert.match(out, /--gray-0: #f4f1ec;/);
    assert.match(out, /--gray-1: #e0ddd8;/);
    // The template declares its ramp outside any layer, and an unlayered rule
    // beats a layered one regardless of order — wrapping this in @layer would
    // produce a file that looks right and does nothing.
    assert.doesNotMatch(out, /@layer/);
  });
});
