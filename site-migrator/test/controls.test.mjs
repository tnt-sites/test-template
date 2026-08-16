import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { compareControls, hasControls } from "../src/qa/controls.mjs";
import { compareImageBoxes } from "../src/qa/assets.mjs";
import { findBorrowedIds, findSelfBackgrounds, findScaffoldingGaps, readOwnedIds } from "../src/qa/props.mjs";

/**
 * The office-tour page: a carousel ported onto the template's own widget.
 *
 * The source drew 96x56 white pills with a 1px #292929 border and a 30px
 * radius, and 12px dots outlined in black that fill #2B8435 on select. The
 * migrated page drew the template's 32px bare chevron and solid brand circles.
 * Every value below is measured off that pair.
 */
const SOURCE_ARROW = {
  role: "prev",
  size: "96x56",
  background: "rgb(255, 255, 255)",
  border: "1px solid rgb(41, 41, 41)",
  radius: "full",
  glyph: "present",
};

const TEMPLATE_ARROW = {
  role: "prev",
  size: "32x32",
  background: "rgba(0, 0, 0, 0)",
  border: "none",
  radius: "4px",
  glyph: "present",
};

const SOURCE_DOTS = {
  count: 5,
  idle: {
    size: "12x12",
    background: "rgba(0, 0, 0, 0)",
    border: "2px solid rgb(0, 0, 0)",
    radius: "full",
    glyph: "none",
  },
  active: {
    size: "12x12",
    background: "rgb(43, 132, 53)",
    border: "2px solid rgb(43, 132, 53)",
    radius: "full",
    glyph: "none",
  },
};

describe("carousel control comparison", () => {
  test("catches the template's arrow standing in for the source's", () => {
    const rows = compareControls(
      { arrows: [SOURCE_ARROW], dots: null },
      { arrows: [TEMPLATE_ARROW], dots: null }
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0].label, "prev arrow");
    assert.deepEqual(
      rows[0].differs.map((d) => d.key),
      ["size", "background", "border", "radius"]
    );
  });

  test("catches dots that kept their size but lost the source's fill", () => {
    const target = {
      arrows: [],
      dots: {
        count: 5,
        idle: { ...SOURCE_DOTS.idle, background: "rgb(0, 90, 156)", border: "none" },
        active: { ...SOURCE_DOTS.active, background: "rgb(120, 180, 220)", border: "none" },
      },
    };

    const rows = compareControls({ arrows: [], dots: SOURCE_DOTS }, target);

    assert.deepEqual(
      rows.map((r) => r.label),
      ["pager dot", "pager dot (active)"]
    );
  });

  test("reports a pager the migrated page hid behind a slide counter", () => {
    // `slideNumbers: true` on the section swaps the indicators for "1 / 5".
    const rows = compareControls({ arrows: [], dots: SOURCE_DOTS }, { arrows: [], dots: null });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].missing, "target");
  });

  test("identical chrome reports nothing", () => {
    const side = { arrows: [SOURCE_ARROW], dots: SOURCE_DOTS };

    assert.deepEqual(compareControls(side, side), []);
  });

  test("a page with no carousel on either side is not compared at all", () => {
    assert.equal(hasControls({ arrows: [], dots: null }, { arrows: [], dots: null }), false);
    assert.equal(hasControls({ arrows: [], dots: null }, { arrows: [SOURCE_ARROW] }), true);
  });
});

describe("image scale comparison", () => {
  test("catches a gallery photo stretched past its intrinsic width", () => {
    // 675x450 in the source; `width: 100%` in the template's Image component
    // drew it at the carousel's full 1000px.
    const rows = compareImageBoxes(
      [{ name: "office-tour-3.webp", width: 675, height: 450, natural: 675 }],
      [{ name: "office-tour-3.webp", width: 1000, height: 667, natural: 675 }]
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0].delta, 325);
    assert.equal(rows[0].upscaled, true);
    assert.equal(rows[0].intrinsic, 675);
  });

  test("a resize that stays within the file's own pixels is reported without the upscale flag", () => {
    const rows = compareImageBoxes(
      [{ name: "hero.jpg", width: 1400, height: 700, natural: 2000 }],
      [{ name: "hero.jpg", width: 1000, height: 500, natural: 2000 }]
    );

    assert.equal(rows[0].upscaled, false);
  });

  test("ignores sub-tolerance drift and unpaired files", () => {
    assert.deepEqual(
      compareImageBoxes(
        [{ name: "a.webp", width: 675, height: 450, natural: 675 }],
        [{ name: "a.webp", width: 679, height: 452, natural: 675 }]
      ),
      []
    );
    assert.deepEqual(
      compareImageBoxes([], [{ name: "template-demo.jpg", width: 900, height: 600, natural: 900 }]),
      []
    );
  });
});

describe("content prop audit", () => {
  const page = (sections) => ({ file: "/site/src/content/pages/tour-our-office.md", data: { pageSections: sections } });

  test("catches a bespoke component's id set on a generic one", () => {
    // The real one: `heroes/hero-center` given `id: interior-banner`, so the
    // ported InteriorBanner's `#interior-banner` rules never applied and the
    // no-image blue band came out white.
    const owned = new Map([
      ["interior-banner", ["/site/src/components/page-sections/heroes/interior-banner/InteriorBanner.astro"]],
    ]);

    const findings = findBorrowedIds(
      [page([{ _component: "page-sections/heroes/hero-center", id: "interior-banner" }])],
      owned
    );

    assert.equal(findings.length, 1);
    assert.equal(findings[0].usedBy, "page-sections/heroes/hero-center");
    assert.equal(findings[0].id, "interior-banner");
  });

  test("the component that owns the id may use it", () => {
    const owned = new Map([
      ["interior-banner", ["/site/src/components/page-sections/heroes/interior-banner/InteriorBanner.astro"]],
    ]);

    assert.deepEqual(
      findBorrowedIds(
        [page([{ _component: "page-sections/heroes/interior-banner", id: "interior-banner" }])],
        owned
      ),
      []
    );
  });

  test("an id no component styles is just an anchor", () => {
    assert.deepEqual(
      findBorrowedIds([page([{ _component: "page-sections/ctas/cta-split", id: "financing" }])], new Map()),
      []
    );
  });

  test("catches a section painted with one of its own slides", () => {
    const findings = findSelfBackgrounds([
      page([
        {
          _component: "page-sections/features/office-tour",
          id: "tour",
          tourSlides: [
            { source: "/assets/images/office-tour-3.webp" },
            { source: "/assets/images/office-tour-4.webp" },
          ],
          backgroundImage: { source: "/assets/images/office-tour-3.webp" },
        },
      ]),
    ]);

    assert.equal(findings.length, 1);
    assert.equal(findings[0].image, "/assets/images/office-tour-3.webp");
  });

  test("a background the section does not otherwise display is left alone", () => {
    assert.deepEqual(
      findSelfBackgrounds([
        page([
          {
            _component: "page-sections/ctas/cta-center",
            backgroundImage: { source: "/assets/images/texture.webp" },
            imageSource: "/assets/images/team.webp",
          },
        ]),
      ]),
      []
    );
  });

  test("reads owned ids out of a component's own style block", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mig-owned-"));
    const component = path.join(dir, "heroes", "interior-banner");

    fs.mkdirSync(component, { recursive: true });

    fs.writeFileSync(
      path.join(component, "InteriorBanner.astro"),
      `---\nconst { id = "interior-banner" } = Astro.props;\n---\n` +
        `<section id={id}></section>\n` +
        `<style is:global>\n` +
        `  #interior-banner { padding: 0 }\n` +
        `  #interior-banner .contain { max-width: 600px }\n` +
        `  #interior-banner.banner-no-img { background-color: #9ECAE1 }\n` +
        `  #skip-nudge { margin: 0 }\n` +
        `</style>\n`
    );

    const owned = readOwnedIds(dir);

    assert.ok(owned.has("interior-banner"));
    // One rule is a nudge or an anchor target, not ownership.
    assert.equal(owned.has("skip-nudge"), false);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("catches a bespoke component with no CloudCannon scaffolding", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mig-scaffold-"));
    const component = path.join(dir, "page-sections", "homepage-blocks", "home-banner");

    fs.mkdirSync(component, { recursive: true });
    fs.writeFileSync(path.join(component, "HomeBanner.astro"), "---\n---\n<section></section>\n");

    const findings = findScaffoldingGaps([
      page([{ _component: "page-sections/homepage-blocks/home-banner", id: "banner" }]),
    ], dir);

    assert.equal(findings.length, 1);
    assert.deepEqual(findings[0].missing, [
      "home-banner.cloudcannon.inputs.yml",
      "home-banner.cloudcannon.structure-value.yml",
    ]);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("catches an image-shaped prop the inputs.yml does not type as an image", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mig-scaffold-"));
    const component = path.join(dir, "page-sections", "homepage-blocks", "home-banner");

    fs.mkdirSync(component, { recursive: true });
    fs.writeFileSync(path.join(component, "HomeBanner.astro"), "---\n---\n<section></section>\n");
    fs.writeFileSync(
      path.join(component, "home-banner.cloudcannon.structure-value.yml"),
      "label: Home Banner\n"
    );
    fs.writeFileSync(
      path.join(component, "home-banner.cloudcannon.inputs.yml"),
      "imageAlt:\n  type: text\n"
    );

    const findings = findScaffoldingGaps([
      page([
        {
          _component: "page-sections/homepage-blocks/home-banner",
          id: "banner",
          imageDesktop: "/assets/images/index-banner.webp",
        },
      ]),
    ], dir);

    assert.equal(findings.length, 1);
    assert.equal(findings[0].untypedImageProp, "imageDesktop");
    assert.equal(findings[0].declaredType, "(auto-detected)");

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("a component with the full scaffolding and typed image props is clean", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mig-scaffold-"));
    const component = path.join(dir, "page-sections", "homepage-blocks", "home-banner");

    fs.mkdirSync(component, { recursive: true });
    fs.writeFileSync(path.join(component, "HomeBanner.astro"), "---\n---\n<section></section>\n");
    fs.writeFileSync(
      path.join(component, "home-banner.cloudcannon.structure-value.yml"),
      "label: Home Banner\n"
    );
    fs.writeFileSync(
      path.join(component, "home-banner.cloudcannon.inputs.yml"),
      "imageDesktop:\n  type: image\n"
    );

    assert.deepEqual(
      findScaffoldingGaps([
        page([
          {
            _component: "page-sections/homepage-blocks/home-banner",
            id: "banner",
            imageDesktop: "/assets/images/index-banner.webp",
          },
        ]),
      ], dir),
      []
    );

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("YAML frontmatter is what the audit reads, not a JS object", () => {
    // Guards the parse path the real pages go through.
    const parsed = YAML.parse(
      "pageSections:\n" +
        "  - _component: page-sections/heroes/hero-center\n" +
        "    id: interior-banner\n"
    );
    const findings = findBorrowedIds(
      [{ file: "p.md", data: parsed }],
      new Map([["interior-banner", ["/c/page-sections/heroes/interior-banner/InteriorBanner.astro"]]])
    );

    assert.equal(findings.length, 1);
  });
});
