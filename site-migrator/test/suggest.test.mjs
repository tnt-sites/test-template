import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { suggestComponents, clusterCapabilities, renderSuggestions } from "../src/sections/suggest.mjs";

/** A stand-in library, shaped like a real one. */
const CATALOG = [
  {
    component: "page-sections/ctas/cta-split",
    label: "CTA Split",
    props: ["heading", "subtext", "imageSource", "buttonSections"],
    capabilities: new Set(["heading", "text", "image", "buttons"]),
  },
  {
    component: "page-sections/ctas/cta-center",
    label: "CTA Center",
    props: ["heading", "subtext", "buttonSections"],
    capabilities: new Set(["heading", "text", "buttons"]),
  },
  {
    component: "page-sections/info-blocks/why",
    label: "Why",
    props: ["heading", "items"],
    capabilities: new Set(["heading", "items"]),
  },
  {
    component: "page-sections/homepage-blocks/index-reviews",
    label: "Index Reviews",
    props: ["heading", "items", "buttonSections"],
    capabilities: new Set(["heading", "items", "buttons"]),
  },
];

const cluster = (id, roleSequence, features = {}) => ({
  id,
  roleSequence,
  features,
  members: [{}],
  pages: ["index"],
});

describe("what a cluster needs", () => {
  test("derives capabilities from its structure", () => {
    const needed = clusterCapabilities(cluster("x", ["IMG", "H2", "P", "BTN"]));
    assert.deepEqual([...needed].sort(), ["buttons", "heading", "image", "text"]);
  });

  test("treats a list, carousel or accordion as repeated items", () => {
    assert.ok(clusterCapabilities(cluster("x", ["H2", "LIST(3)"])).has("items"));
    assert.ok(clusterCapabilities(cluster("x", ["H2"], { hasCarousel: true })).has("items"));
    assert.ok(clusterCapabilities(cluster("x", ["H2"], { hasAccordion: true })).has("items"));
  });

  test("ignores run and count suffixes", () => {
    const needed = clusterCapabilities(cluster("x", ["Px{4+}", "LIST(3)"]));
    assert.deepEqual([...needed].sort(), ["items", "text"]);
  });
});

describe("ranking components for a cluster", () => {
  test("prefers a component that can hold everything the cluster has", () => {
    // A component missing `image` would silently drop the section's image.
    const [best] = suggestComponents(cluster("divider", ["IMG", "H2", "P", "BTN"]), CATALOG);
    assert.equal(best.component, "page-sections/ctas/cta-split");
    assert.deepEqual(best.missing, []);
  });

  test("reports what a candidate cannot hold", () => {
    const suggestions = suggestComponents(cluster("divider", ["IMG", "H2", "P"]), CATALOG);
    const center = suggestions.find((s) => s.component.endsWith("cta-center"));
    assert.ok(center.missing.includes("image"), "the operator has to know what would be lost");
  });

  test("uses the cluster's own name as a tiebreaker", () => {
    // Both can hold heading + items + buttons; the name decides.
    const [best] = suggestComponents(
      cluster("reviews", ["H2", "LIST(3)", "BTN"]),
      CATALOG
    );
    assert.equal(best.component, "page-sections/homepage-blocks/index-reviews");
  });

  test("does not over-reach for a simple cluster", () => {
    const [best] = suggestComponents(cluster("intro", ["H2", "LIST(3)"]), CATALOG);
    assert.equal(best.component, "page-sections/info-blocks/why");
  });

  test("returns nothing when the library is empty", () => {
    assert.deepEqual(suggestComponents(cluster("x", ["H2"]), []), []);
  });
});

describe("the suggestions file", () => {
  test("is a pasteable component-map fragment", () => {
    const output = renderSuggestions([cluster("divider", ["IMG", "H2", "P", "BTN"])], CATALOG);
    assert.match(output, /divider:/);
    assert.match(output, /component: page-sections\/ctas\/cta-split/);
    assert.match(output, /structure: IMG H2 P BTN/);
  });

  test("says so when nothing in the library fits", () => {
    const output = renderSuggestions([cluster("odd", ["FORM"])], []);
    assert.match(output, /no component in the library covers this/);
  });
});

describe("page-opening sections", () => {
  const HEROES = [
    ...CATALOG,
    {
      component: "page-sections/heroes/hero-split",
      label: "Hero Split",
      props: ["heading", "subtext", "imageSource", "buttonSections"],
      capabilities: new Set(["heading", "text", "image", "buttons"]),
      specialties: new Set(),
    },
    {
      component: "page-sections/heroes/hero-center",
      label: "Hero Center",
      props: ["heading", "subtext"],
      capabilities: new Set(["heading", "text"]),
      specialties: new Set(),
    },
  ];

  const banner = (leadingShare) => ({
    id: "interior-banner",
    roleSequence: ["H1", "H2", "Px{2}", "IMG"],
    features: {},
    leadingShare,
    members: [{}],
    pages: ["x"],
  });

  test("chooses a hero for content that opens its page", () => {
    // A hero and a mid-page split block are built from the same parts, so
    // position is the only thing that distinguishes them.
    const [best] = suggestComponents(banner(1), HEROES);
    assert.equal(best.component, "page-sections/heroes/hero-split");
  });

  test("still chooses a hero when only some members lead", () => {
    // A cluster drawn from several page layouts is only partly leading.
    const [best] = suggestComponents(banner(0.5), HEROES);
    assert.match(best.component, /heroes\//);
  });

  test("keeps heroes away from mid-page content", () => {
    const [best] = suggestComponents(
      { id: "divider", roleSequence: ["IMG", "H2", "P"], features: {}, leadingShare: 0, members: [{}], pages: ["x"] },
      HEROES
    );
    assert.doesNotMatch(best.component, /heroes\//);
    assert.equal(best.component, "page-sections/ctas/cta-split");
  });

  test("emits variants when only some members have an image", () => {
    // One component cannot serve both: a split layout with no image leaves a
    // gap, a centred one drops the image.
    const cluster = {
      ...banner(1),
      variance: { imageCount: { "0": 4, "1": 25 } },
      members: [{}, {}],
    };
    const output = renderSuggestions([cluster], HEROES);
    assert.match(output, /variants:/);
    assert.match(output, /when: \{ imageCount: \["1", "2", "3\+"\] \}/);
    assert.match(output, /component: page-sections\/heroes\/hero-split/);
    assert.match(output, /component: page-sections\/heroes\/hero-center/);
  });

  test("emits a single component when every member has an image", () => {
    const output = renderSuggestions([{ ...banner(1), variance: {} }], HEROES);
    assert.doesNotMatch(output, /variants:/);
  });
});
