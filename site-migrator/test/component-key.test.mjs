import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import preset, { componentKeyFromPath, pascalToKebab } from "../presets/cloudcannon-astro-starter.mjs";

/**
 * Ground truth for the `_component` key derivation is a real template repo:
 * every `*.cloudcannon.structure-value.yml` carries a hand/CMS-authored
 * `value._component`, which must equal what we derive from its sibling `.astro`
 * file. Set MIGRATOR_TEMPLATE_REPO to run against a checkout.
 */
const TEMPLATE_REPO =
  process.env.MIGRATOR_TEMPLATE_REPO ||
  "/Users/tharvey/Work/CloudCannon/taylor-street-dental";

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

describe("pascalToKebab", () => {
  const cases = [
    ["CtaSplit", "cta-split"],
    ["MeetLandingPerson", "meet-landing-person"],
    ["HeroSplit", "hero-split"],
    ["MainNav", "main-nav"],
    ["FAQSection", "faq-section"],
    ["CTASplit", "cta-split"],
    ["Why", "why"],
    ["IndexReviews", "index-reviews"],
    ["AstroImage", "astro-image"],
    ["UnpicImage", "unpic-image"],
  ];
  for (const [input, expected] of cases) {
    test(`${input} -> ${expected}`, () => {
      assert.equal(pascalToKebab(input), expected);
    });
  }
});

describe("componentKeyFromPath", () => {
  test("collapses filename into parent when they match", () => {
    assert.equal(
      componentKeyFromPath("page-sections/ctas/cta-split/CtaSplit.astro"),
      "page-sections/ctas/cta-split"
    );
  });

  test("appends filename when it differs from parent", () => {
    assert.equal(
      componentKeyFromPath("page-sections/people/meet-landing/MeetLandingPerson.astro"),
      "page-sections/people/meet-landing/meet-landing-person"
    );
  });
});

describe("componentKeyFromPath against a real template repo", () => {
  const componentsDir = path.join(TEMPLATE_REPO, preset.componentsDir);
  const available = fs.existsSync(componentsDir);

  test("derivation matches every authored structure-value _component", { skip: !available }, () => {
    const files = walk(componentsDir);
    const structureValues = files.filter((f) =>
      f.endsWith(".cloudcannon.structure-value.yml")
    );

    assert.ok(
      structureValues.length > 100,
      `expected a populated component library, found ${structureValues.length} structure-value files`
    );

    const mismatches = [];
    let checked = 0;

    for (const svPath of structureValues) {
      const doc = YAML.parse(fs.readFileSync(svPath, "utf8"));
      const authored = doc?.value?._component;
      if (!authored) continue;

      // The sibling .astro file whose kebab name matches this component folder.
      const dir = path.dirname(svPath);
      const kebab = path.basename(svPath).replace(".cloudcannon.structure-value.yml", "");
      const expectedPascal = preset.kebabToPascal(kebab);
      const astroPath = path.join(dir, `${expectedPascal}.astro`);
      if (!fs.existsSync(astroPath)) continue;

      const relPath = path.relative(componentsDir, astroPath);
      const derived = componentKeyFromPath(relPath);
      checked++;

      if (derived !== authored) {
        mismatches.push({ relPath, authored, derived });
      }
    }

    assert.ok(checked > 100, `expected to check >100 components, checked ${checked}`);
    assert.deepEqual(
      mismatches,
      [],
      `key derivation drifted from renderBlock.astro for ${mismatches.length} component(s)`
    );
  });

  test("every _component used in content resolves to a real component", { skip: !available }, () => {
    const contentDir = path.join(TEMPLATE_REPO, preset.contentDir);
    if (!fs.existsSync(contentDir)) return;

    // Build the registry the same way renderBlock.astro does...
    const registry = new Set();
    for (const f of walk(componentsDir)) {
      if (!f.endsWith(".astro") && !f.endsWith(".jsx")) continue;
      registry.add(componentKeyFromPath(path.relative(componentsDir, f)));
    }

    // ...plus virtual array-item components. These have no `.astro` file of
    // their own: the parent renders them inline and declares the key on an
    // `<editable-array-item data-component="…">` (see EmergencyGrid.astro:128,
    // VideoCardRow.astro:77-100). The synthesizer emits arrays the same way, so
    // the registry has to recognise them as legitimate.
    for (const f of walk(componentsDir)) {
      if (!f.endsWith(".astro")) continue;
      const text = fs.readFileSync(f, "utf8");
      for (const m of text.matchAll(/data-component=["']([\w\-/]+)["']/g)) {
        registry.add(m[1]);
      }
    }

    const used = new Set();
    for (const f of walk(contentDir)) {
      if (!/\.mdx?$/.test(f)) continue;
      const text = fs.readFileSync(f, "utf8");
      for (const m of text.matchAll(/^\s*-?\s*_component:\s*["']?([\w\-/]+)["']?\s*$/gm)) {
        used.add(m[1]);
      }
    }

    assert.ok(used.size > 20, `expected content to reference many components, found ${used.size}`);

    const unresolved = [...used].filter((k) => !registry.has(k)).sort();
    assert.deepEqual(
      unresolved,
      [],
      `content references component keys the registry cannot resolve`
    );
  });
});
