import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  sequenceDistance,
  sectionDistance,
  clusterSections,
  roleSubstitutionCost,
  clusterId,
  dedupeIds,
} from "../src/sections/cluster.mjs";

const WEIGHTS = {
  roleSequence: 0.7,
  flowDirection: 0.6,
  columns: 0.6,
  hasOwnBackground: 0.4,
  hasCarousel: 1.0,
  hasAccordion: 1.0,
  hasForm: 1.0,
  containerMaxWidth: 0.2,
  distinctiveClass: 0.8,
};

const PROP_FEATURES = ["imageSide", "buttonCount", "imageCount", "textAlign", "hasOwnBackground"];

const section = (roleSequence, features = {}) => ({
  roleSequence,
  anchorUid: `u:${Math.random()}`,
  classes: [],
  tag: "div",
  features: {
    flowDirection: "column",
    columns: "1",
    hasCarousel: false,
    hasAccordion: false,
    hasForm: false,
    containerMaxWidth: "1100",
    distinctiveClass: "",
    ...features,
  },
});

describe("role substitution cost", () => {
  test("identical roles cost nothing", () => {
    assert.equal(roleSubstitutionCost("H2", "H2"), 0);
  });

  test("a differing quantity of the same role is nearly free", () => {
    // "three cards" and "five cards" are one pattern, not two.
    assert.ok(roleSubstitutionCost("Px{2}", "Px{4+}") <= 0.15);
    assert.ok(roleSubstitutionCost("LIST(3)", "LIST(4+)") <= 0.15);
  });

  test("a list and a paragraph stay meaningfully apart", () => {
    assert.ok(roleSubstitutionCost("P", "LIST") >= 0.5);
  });

  test("unrelated roles cost full price", () => {
    assert.equal(roleSubstitutionCost("FORM", "IMG"), 1);
  });
});

describe("sequence distance", () => {
  test("identical sequences have zero distance", () => {
    assert.equal(sequenceDistance(["H2", "P"], ["H2", "P"]), 0);
  });

  test("an extra paragraph barely matters", () => {
    assert.ok(sequenceDistance(["H2", "P"], ["H2", "P", "P"]) < 0.4);
  });

  test("structurally different sections are far apart", () => {
    assert.ok(sequenceDistance(["H2", "P"], ["FORM", "IMG", "CAROUSEL"]) > 0.8);
  });
});

describe("section distance", () => {
  test("structure dominates the score", () => {
    // Every categorical feature agrees; only the structure differs. Pooling the
    // sequence in with the features would drag this below any usable threshold.
    const a = section(["H2", "P"]);
    const b = section(["FORM", "IMG", "CAROUSEL"]);
    const d = sectionDistance(a, b, { weights: WEIGHTS, propFeatures: PROP_FEATURES });
    assert.ok(d > 0.5, `expected structure to dominate, got ${d.toFixed(3)}`);
  });

  test("features listed as props do not affect identity", () => {
    const left = section(["IMG", "H2", "P"], { imageSide: "left" });
    const right = section(["IMG", "H2", "P"], { imageSide: "right" });
    assert.equal(
      sectionDistance(left, right, { weights: WEIGHTS, propFeatures: PROP_FEATURES }),
      0,
      "an alternating image side is a prop, not a different pattern"
    );
  });

  test("a distinctive class adds signal without overriding structure", () => {
    // The author's own name for a pattern is a tiebreaker, not a separator:
    // two sections built the same way are usually one component regardless of
    // what they are called, so the class nudges the score rather than
    // dominating it. Hashing class names outright is what previously turned one
    // visual pattern into many "unique" shapes.
    const opts = { weights: WEIGHTS, propFeatures: PROP_FEATURES };
    const same = sectionDistance(
      section(["H2", "P"], { distinctiveClass: "why" }),
      section(["H2", "P"], { distinctiveClass: "why" }),
      opts
    );
    const different = sectionDistance(
      section(["H2", "P"], { distinctiveClass: "why" }),
      section(["H2", "P"], { distinctiveClass: "callout" }),
      opts
    );

    assert.equal(same, 0);
    assert.ok(different > same, "a differing class must register as a difference");
    assert.ok(
      different < 0.22,
      "but on its own it must not split one pattern into two clusters"
    );
  });

  test("a distinctive class tips the balance once structure also differs", () => {
    // This is the case that matters in practice: `.why` (heading + list) versus
    // a divider block (heading + prose). Structure alone left them merged.
    const opts = { weights: WEIGHTS, propFeatures: PROP_FEATURES };
    const withoutClass = sectionDistance(
      section(["H2", "LIST(3)"]),
      section(["H2", "P"]),
      opts
    );
    const withClass = sectionDistance(
      section(["H2", "LIST(3)"], { distinctiveClass: "why" }),
      section(["H2", "P"], { distinctiveClass: "block" }),
      opts
    );

    assert.ok(withClass > withoutClass);
    assert.ok(withClass > 0.22, "the pair should now land in separate clusters");
  });
});

describe("clustering", () => {
  test("collapses many instances of one pattern into a single cluster", () => {
    // The shape that previously exploded: same block, alternating image side,
    // varying paragraph counts.
    const sections = [];
    for (let i = 0; i < 20; i++) {
      sections.push(
        section(i % 3 === 0 ? ["IMG", "H2", "P"] : ["IMG", "H2", "Px{2}"], {
          imageSide: i % 2 ? "left" : "right",
          distinctiveClass: "block",
        })
      );
    }

    const clusters = clusterSections(sections, {
      threshold: 0.22,
      weights: WEIGHTS,
      propFeatures: PROP_FEATURES,
    });

    assert.equal(clusters.length, 1, `expected one pattern, got ${clusters.length}`);
    assert.equal(clusters[0].members.length, 20);
  });

  test("reports which features vary, so they can become props", () => {
    const sections = [
      section(["IMG", "H2", "P"], { imageSide: "left", distinctiveClass: "block" }),
      section(["IMG", "H2", "P"], { imageSide: "right", distinctiveClass: "block" }),
    ];
    const [cluster] = clusterSections(sections, {
      threshold: 0.22,
      weights: WEIGHTS,
      propFeatures: PROP_FEATURES,
    });

    assert.ok(cluster.variance.imageSide, "varying features must be surfaced for review");
    assert.deepEqual(cluster.variance.imageSide, { left: 1, right: 1 });
  });

  test("keeps genuinely different patterns apart", () => {
    const sections = [
      section(["H2", "P"], { distinctiveClass: "block" }),
      section(["H2", "P"], { distinctiveClass: "block" }),
      section(["FORM"], { hasForm: true, distinctiveClass: "contact" }),
      section(["CAROUSEL"], { hasCarousel: true, distinctiveClass: "reviews" }),
    ];

    const clusters = clusterSections(sections, {
      threshold: 0.22,
      weights: WEIGHTS,
      propFeatures: PROP_FEATURES,
    });
    assert.equal(clusters.length, 3);
  });

  test("handles an empty input", () => {
    assert.deepEqual(clusterSections([], { threshold: 0.22, weights: WEIGHTS, propFeatures: [] }), []);
  });
});

describe("cluster naming", () => {
  test("prefers a hand-written id or class over generated structure", () => {
    assert.equal(clusterId({ id: "interior-banner", classes: [], roleSequence: ["H2"] }), "interior-banner");
    assert.equal(clusterId({ id: null, classes: ["why"], roleSequence: ["H2"] }), "why");
  });

  test("ignores generic layout class names", () => {
    assert.equal(
      clusterId({ id: null, classes: ["wrapper", "container", "why"], roleSequence: ["H2"] }),
      "why"
    );
  });

  test("falls back to the role sequence when nothing is distinctive", () => {
    assert.equal(
      clusterId({ id: null, classes: ["row", "inner"], roleSequence: ["H2", "P"], tag: "div" }),
      "h2-p"
    );
  });

  test("makes duplicate names unique", () => {
    const clusters = dedupeIds([{ id: "block" }, { id: "block" }, { id: "block" }]);
    assert.deepEqual(clusters.map((c) => c.id), ["block", "block-2", "block-3"]);
  });
});
