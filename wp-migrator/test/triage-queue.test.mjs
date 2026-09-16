import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  indexRegistry,
  pageComponentRefs,
  pascalFile,
  registryFactsFor,
  renderQueueMarkdown,
  resolveEditTargets,
  selectNavSample,
} from "../src/qa/queue.mjs";

/** A scratch content/ir pair, torn down by the OS. */
function fixture({ md, ir }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wpmig-queue-"));
  const contentDir = path.join(root, "content");
  const irDir = path.join(root, "ir");

  fs.mkdirSync(contentDir, { recursive: true });
  fs.mkdirSync(irDir, { recursive: true });
  fs.writeFileSync(path.join(contentDir, "sample.md"), md);
  if (ir) fs.writeFileSync(path.join(irDir, "sample.json"), JSON.stringify(ir));

  return { root, contentDir, irDir, componentsRoot: path.join(root, "components") };
}

const registry = {
  version: 1,
  components: {
    aaa: { kebab: "media-prose", pages: ["index", "about", "contact"] },
    bbb: { kebab: "media-prose-bone", pages: ["sample"] },
    ccc: { kebab: "page-hero-digital", pages: ["sample", "other"] },
  },
};

const MD = `---
blocks:
  - _component: page-sections/wpmig/page-hero-digital
    id: ""
  - _component: page-sections/shared-blocks/content-section
    id: ""
  - _component: page-sections/wpmig/media-prose-bone
    id: ""
---
`;

test("pascalFile matches the generator's naming", () => {
  assert.equal(pascalFile("media-prose-bone"), "MediaProseBone");
  assert.equal(pascalFile("index"), "Index");
});

test("component references come back in document order", () => {
  const { contentDir } = fixture({ md: MD });

  assert.deepEqual(pageComponentRefs(path.join(contentDir, "sample.md")), [
    "page-sections/wpmig/page-hero-digital",
    "page-sections/shared-blocks/content-section",
    "page-sections/wpmig/media-prose-bone",
  ]);
});

test("a page that does not exist yields no references rather than throwing", () => {
  assert.deepEqual(pageComponentRefs("/nowhere/at/all.md"), []);
});

test("edit targets are absolute, carry usedByPages, and flag shared components", () => {
  const { contentDir, irDir, componentsRoot } = fixture({
    md: MD,
    ir: {
      sections: [
        { sectionIndex: 0, id: "page-hero-digital", rootClass: "page-hero-digital" },
        { sectionIndex: 3, id: "media-prose-bone", rootClass: "media-prose-bone" },
      ],
    },
  });

  const { content, components } = resolveEditTargets({
    slug: "sample",
    contentDir,
    irDir,
    byKebab: indexRegistry(registry),
    componentsRoot,
    families: [["media-prose", "media-prose-bone"]],
  });

  assert.ok(path.isAbsolute(content));
  assert.equal(components.length, 3);

  const hero = components[0];
  assert.equal(hero.usedByPages, 2);
  assert.equal(hero.shared, false);
  assert.equal(hero.sectionIndex, 0);
  assert.ok(path.isAbsolute(hero.astro));
  assert.ok(hero.astro.endsWith("page-sections/wpmig/page-hero-digital/PageHeroDigital.astro"));

  // A starter component: used site-wide, so editing it is a different kind of
  // decision and it must not look like a safe one-page edit.
  const shared = components[1];
  assert.equal(shared.shared, true);
  assert.equal(shared.origin, "starter");
  assert.equal(shared.usedByPages, null);

  const bone = components[2];
  assert.equal(bone.usedByPages, 1);
  assert.equal(bone.sectionIndex, 3);
  assert.equal(bone.inNearIdenticalFamily, true);
});

test("a hand-built component in the migrator namespace is not called shared", () => {
  // The registry records only what the generator emitted, so a component
  // written by hand is absent from it. That makes it one page's own, not the
  // whole site's — the opposite of what a missing lookup would otherwise imply.
  const { contentDir, irDir, componentsRoot } = fixture({
    md: `---\nblocks:\n  - _component: page-sections/wpmig/patient-reviews\n---\n`,
  });

  const [comp] = resolveEditTargets({
    slug: "sample",
    contentDir,
    irDir,
    byKebab: indexRegistry(registry),
    componentsRoot,
  }).components;

  assert.equal(comp.origin, "hand-built");
  assert.equal(comp.shared, false);
  assert.equal(comp.usedByPages, null);
});

test("edit targets still resolve when no IR exists for the page", () => {
  const { contentDir, irDir, componentsRoot } = fixture({ md: MD });

  const { components } = resolveEditTargets({
    slug: "sample",
    contentDir,
    irDir,
    byKebab: indexRegistry(registry),
    componentsRoot,
  });

  assert.equal(components.length, 3);
  assert.equal(components[0].sectionIndex, undefined);
  assert.equal(components[0].usedByPages, 2);
});

test("one-off detection counts only components no other page uses", () => {
  const facts = registryFactsFor(
    [
      "page-sections/wpmig/page-hero-digital",
      "page-sections/wpmig/media-prose-bone",
      "page-sections/shared-blocks/content-section",
    ],
    indexRegistry(registry),
    [["media-prose", "media-prose-bone"]]
  );

  assert.deepEqual(facts.oneOffComponents, ["media-prose-bone"]);
  assert.deepEqual(facts.familyMembers, ["media-prose-bone"]);
});

// --- nav sampling -----------------------------------------------------------

const NAV = [
  {
    name: "About Us",
    path: "/our-practice/",
    children: [{ name: "Meet the Dentists", path: "/meet-the-dentists/", children: [] }],
  },
  {
    name: "New Patients",
    path: "/new-patients/",
    children: [
      { name: "Patient Information", path: "/new-patients/#patient-information", children: [] },
      { name: "Financing", path: "/new-patients/#financing-options", children: [] },
      { name: "FAQ", path: "/new-patients/#faq", children: [] },
      { name: "Credit", path: "/dental-implant-credit-qualification/", children: [] },
    ],
  },
  {
    name: "Services",
    path: "",
    children: [
      {
        name: "Cleanings & Prevention",
        path: "",
        children: [{ name: "Checkups", path: "/dental-exams-cleanings/", children: [] }],
      },
      {
        name: "Endodontics",
        path: "",
        children: [{ name: "Root Canals", path: "/root-canal-therapy/", children: [] }],
      },
    ],
  },
  { name: "Contact", path: "/contact/", children: [] },
];

const ROUTES = new Map([
  ["index", "/"],
  ["our-practice", "/our-practice/"],
  ["meet-the-dentists", "/meet-the-dentists/"],
  ["new-patients", "/new-patients/"],
  ["dental-implant-credit-qualification", "/dental-implant-credit-qualification/"],
  ["dental-exams-cleanings", "/dental-exams-cleanings/"],
  ["root-canal-therapy", "/root-canal-therapy/"],
  ["contact", "/contact/"],
]);

const scoredFrom = (scores) =>
  [...ROUTES.keys()].map((slug) => ({ slug, score: scores[slug] ?? 0 }));

test("every top-level nav item and every Services family is represented", () => {
  const picked = selectNavSample({ navData: NAV, routes: ROUTES, scored: scoredFrom({}) });
  const groups = [...picked.values()].map((v) => v.group).sort();

  assert.deepEqual(groups, [
    "About Us",
    "Contact",
    "Home",
    "New Patients",
    "Services › Cleanings & Prevention",
    "Services › Endodontics",
  ]);
});

test("a label-only parent delegates to its children instead of becoming a group", () => {
  const picked = selectNavSample({ navData: NAV, routes: ROUTES, scored: scoredFrom({}) });

  assert.equal(
    [...picked.values()].some((v) => v.group === "Services"),
    false
  );
});

test("anchor children collapse to their host page rather than sampling it repeatedly", () => {
  // Six of this group's children are `/new-patients/#...` fragments into one
  // page. They must contribute that page once, not once per anchor — and the
  // group must still be free to pick a different, worse page.
  const picked = selectNavSample({
    navData: NAV,
    routes: ROUTES,
    scored: scoredFrom({ "new-patients": 50 }),
  });

  assert.equal([...picked.keys()].filter((s) => s === "new-patients").length, 1);
  assert.equal(picked.get("new-patients").group, "New Patients");

  // With the anchors' host page scoring lowest, the sibling real page wins the
  // group — proof the anchors added one candidate rather than six votes.
  const other = selectNavSample({
    navData: NAV,
    routes: ROUTES,
    scored: scoredFrom({ "dental-implant-credit-qualification": 50 }),
  });

  assert.equal(other.get("dental-implant-credit-qualification").group, "New Patients");
  assert.equal(other.has("new-patients"), false);
});

test("within a group the worst-scoring page is the representative", () => {
  const picked = selectNavSample({
    navData: NAV,
    routes: ROUTES,
    scored: scoredFrom({ "our-practice": 10, "meet-the-dentists": 80 }),
  });

  assert.equal(picked.get("meet-the-dentists").group, "About Us");
  assert.equal(picked.has("our-practice"), false);
});

test("sampling is stable when scores tie", () => {
  const once = [
    ...selectNavSample({ navData: NAV, routes: ROUTES, scored: scoredFrom({}) }).keys(),
  ];
  const twice = [
    ...selectNavSample({ navData: NAV, routes: ROUTES, scored: scoredFrom({}) }).keys(),
  ];

  assert.deepEqual(once, twice);
});

test("the homepage is always in the sample even though no nav item points at it", () => {
  assert.ok(selectNavSample({ navData: NAV, routes: ROUTES, scored: scoredFrom({}) }).has("index"));
});

test("a page the nav points at that was never migrated is skipped, not sampled", () => {
  const picked = selectNavSample({
    navData: [{ name: "Ghost", path: "/never-migrated/", children: [] }],
    routes: ROUTES,
    scored: scoredFrom({}),
  });

  assert.equal(
    [...picked.values()].some((v) => v.group === "Ghost"),
    false
  );
});

test("an absent or empty nav yields an empty sample rather than an error", () => {
  assert.equal(selectNavSample({ navData: null, routes: ROUTES, scored: [] }).size, 0);
});

test("the markdown index reports the counts and links to the JSON", () => {
  const md = renderQueueMarkdown({
    generatedAt: "2026-08-31T00:00:00.000Z",
    threshold: 25,
    scoredWithout: [],
    jsonPath: "/tmp/triage/queue.json",
    builtFrom: { kind: "dev-server", origin: "http://localhost:4321" },
    sourceFrom: { kind: "mirror", dir: "/tmp/static" },
    counts: { scored: 48, flagged: 2, captured: 2 },
    pages: [
      {
        rank: 1,
        slug: "a",
        score: 71,
        band: "high",
        reasons: [
          { label: "Images the source shows that the build never renders", detail: "4 images" },
        ],
        shots: { 1440: { original: "/tmp/triage/a/original@1440.png" } },
      },
      {
        rank: 2,
        slug: "b",
        score: 30,
        band: "medium",
        reasons: [],
        shots: null,
        captureError: "boom",
      },
    ],
  });

  assert.match(md, /2 of 48 pages flagged \(threshold 25\)/);
  assert.match(md, /http:\/\/localhost:4321 \(dev server\)/);
  assert.match(md, /\/tmp\/triage\/queue\.json/);
  assert.match(md, /\| 1 \| 71 \| high \| a \|/);
  assert.match(md, /capture failed/);
});
