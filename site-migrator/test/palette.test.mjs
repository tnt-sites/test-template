import { test, describe } from "node:test";
import assert from "node:assert/strict";
import postcss from "postcss";
import safeParser from "postcss-safe-parser";
import {
  colorsInValue,
  weighColors,
  clusterColors,
  assignRoles,
  baseElementColors,
  extractHoverColors,
  isNeutral,
} from "../src/css/tokens/palette.mjs";

/** Parse CSS into the rule shape `loadStylesheets` produces. */
function rulesFrom(css) {
  const root = postcss.parse(css, { parser: safeParser });
  const rules = [];
  root.walkRules((rule) => {
    const atRuleChain = [];
    for (let p = rule.parent; p && p.type !== "root"; p = p.parent) {
      if (p.type === "atrule") atRuleChain.unshift(`@${p.name} ${p.params}`.trim());
    }
    rules.push({
      selectors: rule.selectors,
      atRuleChain,
      decls: rule.nodes
        .filter((n) => n.type === "decl")
        .map((d) => ({ prop: d.prop, value: d.value })),
    });
  });
  return rules;
}

describe("colorsInValue", () => {
  test("finds hex, rgb and named colours", () => {
    assert.deepEqual(colorsInValue("#751414"), ["#751414"]);
    assert.deepEqual(colorsInValue("rgb(19, 69, 69)"), ["rgb(19, 69, 69)"]);
    assert.deepEqual(colorsInValue("red"), ["red"]);
  });

  test("finds the colour inside a shorthand", () => {
    assert.deepEqual(colorsInValue("1px solid #bfb197"), ["#bfb197"]);
  });

  test("ignores keywords that are not colours", () => {
    assert.deepEqual(colorsInValue("none"), []);
    assert.deepEqual(colorsInValue("1px solid"), []);
    assert.deepEqual(colorsInValue("no-repeat center"), []);
  });
});

describe("baseElementColors", () => {
  test("reads base tokens off bare-element rules", () => {
    const rules = rulesFrom(`
      body { color: #626262; background-color: #F4F1EC; }
      p { color: #626262; }
      a { color: #751414; text-decoration: none; }
      h2 { color: #000000; }
    `);
    const base = baseElementColors(rules);
    assert.equal(base.a, "#751414");
    assert.equal(base.p, "#626262");
    assert.equal(base.h2, "#000000");
  });

  test("later rules win, matching the cascade", () => {
    const rules = rulesFrom(`a { color: #111111; } a { color: #751414; }`);
    assert.equal(baseElementColors(rules).a, "#751414");
  });

  test("ignores compound selectors and media-scoped overrides", () => {
    const rules = rulesFrom(`
      a { color: #751414; }
      nav ul li a { color: #ffffff; }
      .card a { color: #134545; }
      @media (max-width: 600px) { a { color: #00ff00; } }
    `);
    assert.equal(
      baseElementColors(rules).a,
      "#751414",
      "only unconditional bare-tag rules define a base token"
    );
  });
});

describe("extractHoverColors", () => {
  test("recovers the link hover colour, which computed style cannot report", () => {
    const rules = rulesFrom(`a { color: #751414; } a:hover { color: #205D5D; }`);
    assert.equal(extractHoverColors(rules).link, "#205d5d");
  });
});

describe("clusterColors", () => {
  test("merges perceptually indistinguishable colours", () => {
    const weighted = [
      { hex: "#134545", area: 1000, occurrences: 5, props: new Set(["background-color"]), selectors: new Set(["a"]) },
      { hex: "#144646", area: 10, occurrences: 1, props: new Set(["color"]), selectors: new Set(["b"]) },
    ];
    const clusters = clusterColors(weighted, { maxDeltaE: 0.025 });
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0].hex, "#134545", "the highest-area member names the cluster");
    assert.equal(clusters[0].occurrences, 6);
  });

  test("keeps a genuine brand/hover pair apart", () => {
    const weighted = [
      { hex: "#134545", area: 1000, occurrences: 5, props: new Set(["background-color"]), selectors: new Set(["a"]) },
      { hex: "#205d5d", area: 500, occurrences: 3, props: new Set(["color"]), selectors: new Set(["b"]) },
    ];
    const clusters = clusterColors(weighted, { maxDeltaE: 0.025 });
    assert.equal(clusters.length, 2, "a brand colour and its lighter variant are distinct intents");
  });

  test("orders clusters by rendered area, not occurrence count", () => {
    const weighted = [
      { hex: "#ff0000", area: 10, occurrences: 50, props: new Set(["color"]), selectors: new Set(["a"]) },
      { hex: "#00ff00", area: 9999, occurrences: 1, props: new Set(["background-color"]), selectors: new Set(["b"]) },
    ];
    const clusters = clusterColors(weighted);
    assert.equal(clusters[0].hex, "#00ff00", "a colour covering the page outranks a frequent one-off");
  });
});

describe("weighColors", () => {
  test("weights text colour below background colour for the same area", () => {
    const rules = rulesFrom(`.a { color: #111111; } .b { background-color: #222222; }`);
    const index = {
      selectorUids: new Map([[".a", ["p:1"]], [".b", ["p:2"]]]),
      areaByUid: new Map([["p:1", 1000], ["p:2", 1000]]),
      totalArea: 2000,
      elementCount: 2,
    };
    const weighted = weighColors(rules, index);
    const text = weighted.find((w) => w.hex === "#111111");
    const bg = weighted.find((w) => w.hex === "#222222");
    assert.ok(bg.area > text.area, "text covers less of its box than a background does");
  });

  test("skips fully transparent colours", () => {
    const rules = rulesFrom(`.a { background-color: rgba(0,0,0,0); }`);
    assert.deepEqual(weighColors(rules, null), []);
  });
});

describe("assignRoles", () => {
  const measured = {
    body: { "background-color": "rgb(244, 241, 236)", color: "rgb(98, 98, 98)" },
    paragraph: { color: "rgb(255, 255, 255)" }, // an unrepresentative page
    h2: { color: "rgb(255, 255, 255)" },
    link: { color: "rgb(255, 255, 255)" },
  };

  const baseColors = { a: "#751414", p: "#626262", h2: "#000000", body: "#626262" };

  test("prefers stylesheet base rules over noisy measurement", () => {
    const { roles } = assignRoles([], measured, { baseColors, hoverColors: { link: "#205d5d" } });

    assert.equal(roles.link, "#751414", "`a { color }` defines the link token");
    assert.equal(roles.text, "#626262");
    assert.equal(roles.heading, "#000000");
    assert.equal(roles.linkHover, "#205d5d");
  });

  test("still takes the page background from measurement", () => {
    const { roles } = assignRoles([], measured, { baseColors });
    assert.equal(roles.bgPage, "#f4f1ec", "what the browser painted is what matters here");
  });

  test("assigns brand to the largest non-neutral background used more than once", () => {
    const clusters = [
      { hex: "#f4f1ec", area: 9999, occurrences: 9, props: new Set(["background-color"]), selectors: new Set(["body", "main"]) },
      { hex: "#134545", area: 500, occurrences: 5, props: new Set(["background-color"]), selectors: new Set([".btn", "header"]) },
      { hex: "#abcdef", area: 400, occurrences: 1, props: new Set(["background-color"]), selectors: new Set([".one-off"]) },
    ];
    const { roles } = assignRoles(clusters, measured, { baseColors });
    assert.equal(roles.brand, "#134545", "a single-selector accent must not claim the brand slot");
  });

  test("gives every remaining significant colour a token", () => {
    const clusters = [
      { hex: "#d0c8b7", area: 300, occurrences: 4, props: new Set(["background-color"]), selectors: new Set(["#hd-bottom"]) },
    ];
    const { extras } = assignRoles(clusters, measured, { baseColors });
    assert.ok(
      extras.some((e) => e.hex === "#d0c8b7"),
      "colours with no semantic slot still need a name, or they get hardcoded by hand later"
    );
  });
});

describe("isNeutral", () => {
  test("classifies greys and tinted neutrals as neutral", () => {
    assert.equal(isNeutral("#808080"), true);
    assert.equal(isNeutral("#f4f1ec"), true);
  });

  test("classifies brand colours as non-neutral", () => {
    assert.equal(isNeutral("#134545"), false);
    assert.equal(isNeutral("#751414"), false);
  });
});
