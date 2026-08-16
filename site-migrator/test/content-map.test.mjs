import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mapToComponent, resolveComponent, clearUnfilledPlaceholders } from "../src/content/map-to-component.mjs";
import { evaluateOverride, renderPage } from "../src/content/index.mjs";
import { htmlToMarkdown, htmlToInline } from "../src/content/html-to-md.mjs";
import { detectTitleSuffix, stripTitleSuffix } from "../src/content/seo.mjs";

/** A throwaway component library with a realistic structure-value. */
function makeLibrary() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mig-lib-"));
  const dir = path.join(root, "page-sections/ctas/cta-split");
  fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(
    path.join(dir, "cta-split.cloudcannon.structure-value.yml"),
    `label: CTA Split
value:
  _component: page-sections/ctas/cta-split
  id: ""
  heading: Heading text
  subtext: Subtext placeholder text that will be replaced with actual content.
  imageSource: /src/assets/images/component-library/dunedin-cliff.jpg
  imageAlt: CTA image
  buttonSections:
    - _component: building-blocks/core-elements/button
      text: My Button
      link: ""
      variant: primary
  reverse: false
  backgroundColor: base
  backgroundColorHex: ""
`
  );

  const centerDir = path.join(root, "page-sections/heroes/hero-center");
  fs.mkdirSync(centerDir, { recursive: true });
  fs.writeFileSync(
    path.join(centerDir, "hero-center.cloudcannon.structure-value.yml"),
    `label: Hero Center
value:
  _component: page-sections/heroes/hero-center
  heading: Heading text
  subtext: ""
`
  );

  const gridDir = path.join(root, "page-sections/info-blocks/emergency-grid");
  fs.mkdirSync(gridDir, { recursive: true });
  fs.writeFileSync(
    path.join(gridDir, "emergency-grid.cloudcannon.structure-value.yml"),
    `label: Emergency Grid
value:
  _component: page-sections/info-blocks/emergency-grid
  heading: Most Common Dental Emergencies
  subtext: ""
  emergencyItems:
    - _component: page-sections/info-blocks/emergency-grid/emergency-item
      title: Emergency Item
      iconPreset: toothache
      contentSections:
        - _component: building-blocks/core-elements/text
          text: Lorem ipsum dolor sit amet.
_structures:
  emergencyItems:
    values:
      - label: Emergency Item
        value:
          _component: page-sections/info-blocks/emergency-grid/emergency-item
          title: Emergency Item
          iconPreset: toothache
          contentSections: []
        _inputs:
          iconPreset:
            type: select
            options:
              values:
                - id: toothache
                  name: Toothache
                - id: chipped-tooth
                  name: Chipped Tooth
                - id: lost-filling-crown
                  name: Lost Filling or Crown
                - id: gum-lip-tongue-injury
                  name: Gums, Lips or Tongue Injury
`
  );

  const whyDir = path.join(root, "page-sections/info-blocks/why");
  fs.mkdirSync(whyDir, { recursive: true });
  fs.writeFileSync(
    path.join(whyDir, "why.cloudcannon.structure-value.yml"),
    `label: Why
value:
  _component: page-sections/info-blocks/why
  heading: Heading text
  items:
    - _component: building-blocks/core-elements/list/list-item
      text: List item 1
      iconName: check
      iconColor: default
_structures:
  items:
    values:
      - label: List Item
        value:
          _component: building-blocks/core-elements/list/list-item
          text: List item
          iconName: check
          iconColor: default
        _inputs:
          iconColor:
            type: select
            options:
              values:
                - id: default
                  name: Default
                - id: brand
                  name: Brand
`
  );

  return root;
}

const extracted = (overrides = {}) => ({
  uid: "p:0001",
  props: {},
  unmapped: [],
  embeds: [],
  bodyHtml: "",
  background: { hex: null, image: false },
  sourceId: null,
  ...overrides,
});

describe("mapping content onto a component", () => {
  const componentsDir = makeLibrary();

  test("fills the component's real props", () => {
    const result = mapToComponent(
      extracted({
        props: { heading: "What are Dental Veneers?", imageSource: "/img/v.webp", imageAlt: "Veneers" },
        bodyHtml: "<p>Custom tooth coverings.</p>",
      }),
      "page-sections/ctas/cta-split",
      { componentsDir }
    );

    assert.equal(result.value.heading, "What are Dental Veneers?");
    assert.equal(result.value.subtext, "Custom tooth coverings.");
    assert.equal(result.value.imageSource, "/img/v.webp");
    assert.equal(result.value.imageAlt, "Veneers");
    assert.equal(result.value._component, "page-sections/ctas/cta-split");
  });

  test("clears demo content that real content did not replace", () => {
    // Shipping stock photography and "placeholder text" across every migrated
    // page is worse than an empty field: an empty field looks unfinished, a
    // plausible placeholder ships silently.
    const result = mapToComponent(
      extracted({ props: { heading: "Just a heading" } }),
      "page-sections/ctas/cta-split",
      { componentsDir }
    );

    assert.equal(result.value.imageSource, "");
    assert.equal(result.value.subtext, "");
    assert.deepEqual(result.value.buttonSections, []);
    assert.equal(result.value.heading, "Just a heading");
  });

  test("keeps real buttons and drops the seeded example", () => {
    const result = mapToComponent(
      extracted({ props: { buttonSections: [{ text: "Book now", link: "/contact.html" }] } }),
      "page-sections/ctas/cta-split",
      { componentsDir, urlMap: new Map([["/contact.html", "/contact/"]]) }
    );

    assert.equal(result.value.buttonSections.length, 1);
    assert.equal(result.value.buttonSections[0].text, "Book now");
    assert.equal(result.value.buttonSections[0].link, "/contact/", "links route through the url map");
    assert.equal(
      result.value.buttonSections[0]._component,
      "building-blocks/core-elements/button",
      "the seeded shape supplies nested component keys"
    );
  });

  test("records content the component cannot hold instead of dropping it", () => {
    const result = mapToComponent(
      extracted({ props: { heading: "H" }, embeds: [{ prop: "mapEmbedUrl", value: "https://maps/x" }] }),
      "page-sections/heroes/hero-center",
      { componentsDir }
    );

    assert.ok(
      result.unmapped.some((u) => u.field === "mapEmbedUrl"),
      "an embed with no home must be reported, never silently discarded"
    );
  });

  test("fills an item select from the source's own labels", () => {
    // The source writes the vocabulary as display copy ("Gums, Lips or Tongue
    // Injury"), so a slug comparison never matches and every card would keep
    // the seeded icon — eleven toothaches on the emergency page.
    const result = mapToComponent(
      extracted({
        props: {
          heading: "The Most Common Dental Emergencies",
          items: [
            { heading: "Chipped Tooth", text: "Chipped Tooth" },
            { heading: "Lost Filling or Crown", text: "Lost Filling or Crown" },
            { heading: "Gums, Lips or Tongue Injury", text: "Gums, Lips or Tongue Injury" },
          ],
        },
      }),
      "page-sections/info-blocks/emergency-grid",
      { componentsDir }
    );

    assert.deepEqual(
      result.value.emergencyItems.map((i) => [i.title, i.iconPreset]),
      [
        ["Chipped Tooth", "chipped-tooth"],
        ["Lost Filling or Crown", "lost-filling-crown"],
        ["Gums, Lips or Tongue Injury", "gum-lip-tongue-injury"],
      ]
    );
    assert.deepEqual(
      result.value.emergencyItems[0].contentSections,
      [],
      "the seeded item's demo modal must not ship on every card"
    );
    assert.ok(
      !("heading" in result.value.emergencyItems[0]),
      "only fields the item shape declares are written"
    );
  });

  test("leaves a presentation select at the component's default", () => {
    const result = mapToComponent(
      extracted({
        props: {
          heading: "Why Choose Us?",
          items: [{ text: "Trusted Since 1981" }, { text: "Multiple Sedation Options" }],
        },
      }),
      "page-sections/info-blocks/why",
      { componentsDir }
    );

    assert.equal(result.value.items[0].iconColor, "default");
    assert.equal(result.value.items[0].text, "Trusted Since 1981");
    assert.ok(!result.unmapped.some((u) => u.field.endsWith("iconColor")));
  });

  test("reports a missing component rather than writing a broken block", () => {
    const result = mapToComponent(extracted(), "page-sections/does/not-exist", { componentsDir });
    assert.match(result.error, /No structure-value/);
  });

  test("applies a measured background only where the component exposes one", () => {
    const result = mapToComponent(
      extracted({ props: { heading: "H" }, background: { hex: "#d0c8b7", image: false } }),
      "page-sections/ctas/cta-split",
      { componentsDir }
    );
    assert.equal(result.value.backgroundColorHex, "#d0c8b7");
    assert.equal(result.value.backgroundColor, "none");
  });
});

describe("variant selection", () => {
  const entry = {
    variants: [
      { when: { imageCount: ["1", "2", "3+"] }, component: "page-sections/heroes/hero-split" },
      { component: "page-sections/heroes/hero-center" },
    ],
  };

  test("picks the split layout when the source block has an image", () => {
    const resolved = resolveComponent(entry, { features: { imageCount: "1" } });
    assert.equal(resolved.component, "page-sections/heroes/hero-split");
  });

  test("falls back to the centred layout when it has none", () => {
    const resolved = resolveComponent(entry, { features: { imageCount: "0" } });
    assert.equal(resolved.component, "page-sections/heroes/hero-center");
  });

  test("accepts a plain string or a plain object mapping", () => {
    assert.equal(resolveComponent("a/b", {}).component, "a/b");
    assert.equal(resolveComponent({ component: "a/b" }, {}).component, "a/b");
  });

  test("returns nothing when a cluster is unmapped", () => {
    assert.equal(resolveComponent(undefined, {}), null);
  });
});

describe("prop override expressions", () => {
  const section = { features: { imageSide: "left", imageCount: "1" } };

  test("evaluates a feature comparison", () => {
    assert.equal(evaluateOverride("$feature.imageSide == 'left'", section, {}), true);
    assert.equal(evaluateOverride("$feature.imageSide == 'right'", section, {}), false);
    assert.equal(evaluateOverride("$feature.imageSide != 'right'", section, {}), true);
  });

  test("reads a feature directly", () => {
    assert.equal(evaluateOverride("$feature.imageCount", section, {}), "1");
  });

  test("passes literals through untouched", () => {
    assert.equal(evaluateOverride(true, section, {}), true);
    assert.equal(evaluateOverride("plain", section, {}), "plain");
  });
});

describe("html to markdown", () => {
  test("preserves embeds rather than discarding their source", () => {
    const md = htmlToMarkdown('<p>Find us</p><iframe src="https://maps.example/x"></iframe>');
    assert.match(md, /maps\.example\/x/, "an iframe URL is unrecoverable once dropped");
  });

  test("converts links and emphasis", () => {
    assert.equal(htmlToMarkdown('<p>See <a href="/a/">this</a></p>'), "See [this](/a/)");
  });

  test("flattens a heading to inline markdown", () => {
    assert.equal(htmlToInline("<h2>Big <em>news</em></h2>"), "Big *news*");
  });
});

describe("page rendering", () => {
  test("writes frontmatter with the section list", () => {
    const md = renderPage({
      page: { id: "veneers" },
      blocks: [{ _component: "page-sections/ctas/cta-split", heading: "H" }],
      notes: [],
      seo: { title: "Veneers", description: "About veneers" },
    });

    assert.match(md, /^---\n/);
    assert.match(md, /title: Veneers/);
    assert.match(md, /description: About veneers/);
    assert.match(md, /_component: page-sections\/ctas\/cta-split/);
  });

  test("carries unmapped content onto the page", () => {
    const md = renderPage({
      page: { id: "contact" },
      blocks: [],
      notes: [{ component: "x/y", unmapped: [{ field: "mapEmbedUrl", content: "https://maps/x" }] }],
      seo: { title: "Contact" },
    });
    // `_mig` is reserved for the provenance header; leftovers use their own key
    // so the two cannot collide into a duplicate YAML mapping key.
    assert.match(md, /_migUnmapped:/);
    assert.doesNotMatch(md, /^_mig:/m);
    assert.match(md, /mapEmbedUrl/);
  });
});

describe("title suffix handling", () => {
  test("detects a suffix shared across most pages", () => {
    const titles = [
      "Veneers Springfield MA | Taylor Street Dental",
      "Contact Us | Taylor Street Dental",
      "About Our Office | Taylor Street Dental",
      "Dental Implants | Taylor Street Dental",
    ];
    assert.equal(detectTitleSuffix(titles), "Taylor Street Dental");
  });

  test("does not invent a suffix when titles disagree", () => {
    assert.equal(detectTitleSuffix(["A | One", "B | Two", "C | Three"]), null);
  });

  test("strips the suffix without eating the title", () => {
    assert.equal(stripTitleSuffix("Veneers | Taylor Street Dental", "Taylor Street Dental"), "Veneers");
    assert.equal(stripTitleSuffix("Taylor Street Dental", "Taylor Street Dental"), "Taylor Street Dental");
  });
});
