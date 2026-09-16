import assert from "node:assert/strict";
import test from "node:test";
import {
  WEIGHTS,
  bandFor,
  rankPages,
  scorePage,
  ubiquitousMissingImages,
} from "../src/qa/triage.mjs";

const coverage = (id, builtCount, extra = {}) => ({
  kind: "coverage",
  id,
  label: `label:${id}`,
  hint: `hint:${id}`,
  status: "present",
  builtCount,
  examples: ["a", "b"],
  ...extra,
});

const pattern = (id, status, sourceCount = 2, builtCount = 0) => ({
  kind: "pattern",
  id,
  label: `label:${id}`,
  hint: `hint:${id}`,
  status,
  sourceCount,
  builtCount,
  examples: ["div.x"],
});

const byId = (page, id) => page.reasons.find((r) => r.id === id);

test("a page with nothing wrong scores zero and is not flagged", () => {
  const page = scorePage({ slug: "clean", route: "/clean/" });

  assert.equal(page.score, 0);
  assert.equal(page.flagged, false);
  assert.equal(page.band, "low");
  assert.deepEqual(page.reasons, []);
});

test("an absent uncertainty record scores exactly the same as an all-clear one", () => {
  // The guarantee the whole design rests on: every page already migrated
  // predates the uncertainty record, so "no record" must never read as "bad".
  const input = { slug: "legacy", findings: [coverage("droppedImages", 3)] };
  const allClear = {
    page: "legacy",
    sections: [
      {
        sectionIndex: 0,
        component: "hero",
        repeat: { confidence: "high", itemCount: 3 },
        icons: { fuzzy: [], unresolved: [] },
        emptyish: false,
      },
    ],
    pageLevel: { missingAssets: [], skippedSections: [] },
  };

  assert.equal(
    scorePage({ ...input, uncertainty: null }).score,
    scorePage({ ...input, uncertainty: allClear }).score
  );
  assert.equal(scorePage({ ...input, uncertainty: null }).uncertaintyAvailable, false);
  assert.equal(scorePage({ ...input, uncertainty: allClear }).uncertaintyAvailable, true);
});

test("pixel differences below the noise floor are not a reason at all", () => {
  const under = scorePage({ slug: "p", pixel: { 1440: { ratio: 0.015, heightDelta: 0 } } });
  const over = scorePage({ slug: "p", pixel: { 1440: { ratio: 0.2, heightDelta: -412 } } });

  assert.equal(under.score, 0);
  assert.ok(over.score > 0);
  assert.match(byId(over, "pixel").detail, /20\.0% of pixels differ at 1440px/);
  assert.match(byId(over, "pixel").detail, /412px shorter/);
});

test("the worst viewport decides the pixel channel, not the average", () => {
  const page = scorePage({
    slug: "p",
    pixel: { 1440: { ratio: 0.01 }, 768: { ratio: 0.01 }, 390: { ratio: 0.5 } },
  });

  assert.equal(byId(page, "pixel").where.viewport, 390);
});

test("every channel respects its cap", () => {
  const many = Array.from({ length: 40 }, (_, i) => pattern(`p${i}`, "missing"));
  const page = scorePage({
    slug: "p",
    pixel: { 1440: { ratio: 1 } },
    findings: [coverage("droppedImages", 500), coverage("droppedContent", 500), ...many],
  });

  const sum = (source) =>
    page.reasons.filter((r) => r.source === source).reduce((n, r) => n + r.points, 0);

  assert.ok(byId(page, "pixel").points <= WEIGHTS.pixel.cap);
  assert.ok(byId(page, "droppedImages").points <= WEIGHTS.droppedImages.cap);
  assert.ok(byId(page, "droppedContent").points <= WEIGHTS.droppedContent.cap);
  assert.ok(sum("pattern") <= WEIGHTS.pattern.cap);
  assert.ok(page.score <= 100);
});

test("adding a finding never lowers a page's score", () => {
  const base = { slug: "p", findings: [coverage("droppedContent", 2)] };
  let previous = scorePage(base).score;

  const additions = [
    coverage("droppedImages", 4),
    coverage("duplicatedContent", 2),
    coverage("headingCount", 0),
    pattern("fixedBackground", "missing"),
    {
      kind: "smell",
      id: "stackedCards",
      label: "l",
      hint: "h",
      status: "present",
      builtCount: 3,
      examples: [],
    },
  ];

  for (let i = 0; i < additions.length; i += 1) {
    const score = scorePage({
      ...base,
      findings: [...base.findings, ...additions.slice(0, i + 1)],
    }).score;

    assert.ok(
      score >= previous,
      `adding ${additions[i].id} lowered the score (${previous} -> ${score})`
    );
    previous = score;
  }
});

test("a kept pattern is not a defect, and a partial one is scored below a missing one", () => {
  const kept = scorePage({ slug: "p", findings: [pattern("fixedBackground", "kept", 2, 2)] });
  const partial = scorePage({ slug: "p", findings: [pattern("fixedBackground", "partial", 4, 1)] });
  const missing = scorePage({ slug: "p", findings: [pattern("fixedBackground", "missing")] });

  assert.equal(kept.score, 0);
  assert.ok(partial.score > 0);
  assert.ok(missing.score > partial.score);
});

test("coverage findings keep their own label and hint verbatim", () => {
  const finding = coverage("droppedImages", 2);
  const page = scorePage({ slug: "p", findings: [finding] });

  assert.equal(byId(page, "droppedImages").label, finding.label);
  assert.equal(byId(page, "droppedImages").hint, finding.hint);
});

test("a missing <h1> outweighs an extra one", () => {
  const none = scorePage({ slug: "p", findings: [coverage("headingCount", 0)] });
  const extra = scorePage({ slug: "p", findings: [coverage("headingCount", 2)] });

  assert.ok(none.score > extra.score);
  assert.match(byId(none, "headingCount").detail, /no <h1>/);
  assert.match(byId(extra, "headingCount").detail, /2 <h1>/);
});

test("uncertainty channels score only what the record actually reports", () => {
  const page = scorePage({
    slug: "p",
    uncertainty: {
      sections: [
        {
          sectionIndex: 1,
          component: "cards",
          repeat: { confidence: "low", itemCount: 4 },
          icons: { fuzzy: ["tooth"], unresolved: ["x"] },
        },
        { sectionIndex: 2, component: "band", emptyish: true },
      ],
      pageLevel: { missingAssets: ["/wp-content/uploads/a.jpg"] },
    },
  });

  assert.ok(byId(page, "repeat"));
  assert.ok(byId(page, "icons"));
  assert.ok(byId(page, "emptyish"));
  assert.ok(byId(page, "missingAssets"));
  assert.deepEqual(byId(page, "emptyish").where, { sectionIndex: 2, component: "band" });
});

test("a one-off in a near-identical family scores above a plain one-off", () => {
  const plain = scorePage({
    slug: "p",
    registryFacts: { oneOffComponents: ["media-prose-bone"], familyMembers: [] },
  });
  const forked = scorePage({
    slug: "p",
    registryFacts: { oneOffComponents: ["media-prose-bone"], familyMembers: ["media-prose-bone"] },
  });

  assert.ok(forked.score > plain.score);
  assert.match(byId(forked, "oneOff").detail, /near-identical family/);
});

test("severe verify findings are summarised with the size that changed", () => {
  const page = scorePage({
    slug: "p",
    verifyFindings: [
      {
        key: "welcome to the practice",
        diffs: [{ prop: "fontSize", source: "45px", built: "16px" }],
      },
    ],
  });

  assert.equal(byId(page, "verify").examples[0], '"welcome to the practice" 45px -> 16px');
});

test("reasons come back worst-first", () => {
  const page = scorePage({
    slug: "p",
    findings: [pattern("fixedBackground", "partial", 4, 1), coverage("droppedImages", 5)],
  });

  const points = page.reasons.map((r) => r.points);

  assert.deepEqual(
    points,
    [...points].sort((a, b) => b - a)
  );
  assert.equal(page.reasons[0].id, "droppedImages");
});

test("bands are checked high to low", () => {
  assert.equal(bandFor(100), "high");
  assert.equal(bandFor(60), "high");
  assert.equal(bandFor(59), "medium");
  assert.equal(bandFor(25), "medium");
  assert.equal(bandFor(24), "low");
  assert.equal(bandFor(0), "low");
});

test("ranking is worst-first, stable on ties, and re-applies the threshold", () => {
  const scored = [
    { slug: "b", score: 30, reasons: [] },
    { slug: "a", score: 30, reasons: [] },
    { slug: "c", score: 70, reasons: [] },
    { slug: "d", score: 5, reasons: [] },
  ];

  const ranked = rankPages(scored, { threshold: 25 });

  assert.deepEqual(
    ranked.map((p) => p.slug),
    ["c", "a", "b", "d"]
  );
  assert.deepEqual(
    ranked.map((p) => p.rank),
    [1, 2, 3, 4]
  );
  assert.deepEqual(
    ranked.map((p) => p.flagged),
    [true, true, true, false]
  );
  assert.equal(ranked[0].band, "high");
});

test("the threshold moves what is flagged without changing any score", () => {
  const scored = [{ slug: "a", score: 30, reasons: [] }];

  assert.equal(rankPages(scored, { threshold: 25 })[0].flagged, true);
  assert.equal(rankPages(scored, { threshold: 60 })[0].flagged, false);
  assert.equal(rankPages(scored, { threshold: 60 })[0].score, 30);
});

test("a capped channel's reason points sum to exactly the cap", () => {
  // The points beside each reason are the explanation of the score; if the
  // rounding loses or invents a point they stop being one.
  const many = Array.from({ length: 7 }, (_, i) => pattern(`p${i}`, "missing"));
  const page = scorePage({ slug: "p", findings: many });
  const sum = page.reasons.filter((r) => r.source === "pattern").reduce((n, r) => n + r.points, 0);

  assert.equal(sum, WEIGHTS.pattern.cap);
  assert.equal(page.score, WEIGHTS.pattern.cap);
});

test("an image missing from every build is theme decoration, not a page defect", () => {
  // A preloader spinner reaches the source through live CSS, so a mirrored
  // snapshot references it and no build ever has it. Counted per page it adds
  // the same points everywhere, which ranks nothing.
  const perPage = [
    ["spin_wh", "body_wh", "hero"],
    ["spin_wh", "body_wh"],
    ["spin_wh", "body_wh"],
    ["spin_wh", "body_wh"],
  ];

  const ignored = ubiquitousMissingImages(perPage);

  assert.ok(ignored.has("spin_wh"));
  assert.ok(ignored.has("body_wh"));
  assert.equal(ignored.has("hero"), false);
});

test("a corpus too small to generalise from ignores nothing", () => {
  assert.equal(ubiquitousMissingImages([["a"], ["a"]]).size, 0);
});

test("one page rendering the image does not restore the noise everywhere", () => {
  const perPage = Array.from({ length: 20 }, (_, i) => (i === 7 ? [] : ["spin_wh"]));

  assert.ok(ubiquitousMissingImages(perPage).has("spin_wh"));
});
