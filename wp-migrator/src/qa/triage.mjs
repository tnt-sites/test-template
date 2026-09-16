/**
 * Which migrated pages are worth a human's eyes, and in what order?
 *
 * Every other QA module here answers a narrow question well — `dev-verify`
 * diffs the typography of text that exists on both sides, `layout-patterns`
 * checks the shape of what survived, `content-coverage` checks that nothing
 * went missing, `compare` counts mismatched pixels. Each prints its own report,
 * and none of them ranks a page against another page. With 48 pages that is the
 * question that actually blocks work: not "what is wrong with this page" but
 * "which page do I open first".
 *
 * So this module does one thing: merge those independent signals into a single
 * 0-100 score per page, with the reasons that produced it. It is pure — no fs,
 * no browser, no network — because the scoring policy is the part worth pinning
 * in tests, and everything it scores is already computed elsewhere.
 *
 * Two design choices are load-bearing:
 *
 *   - **Additive with per-channel caps, not a weighted mean.** A mean lets one
 *     clean viewport wash out a catastrophic one, and lets a page with a single
 *     severe defect (every photo missing) score mid-table because everything
 *     else about it is fine. Any one severe defect must be enough to flag on its
 *     own, and several must stack. The caps stop a single noisy channel from
 *     saturating the score by itself.
 *
 *   - **An absent signal contributes exactly zero, never a penalty.** The
 *     generation-time uncertainty record (see `.wpmig/uncertainty/`) did not
 *     exist when the pages in front of us were generated, and those pages were
 *     hand-finished afterwards, so re-running the generator to obtain it is not
 *     an option. A scorer that read "no record" as "unknown, therefore
 *     suspicious" would flag all 48 at once and say nothing. `scorePage` with
 *     `uncertainty: null` must return the same score as `scorePage` with an
 *     all-clear record — there is a test that pins exactly that.
 */

/**
 * Every constant the score depends on, in one object.
 *
 * Tuning happens here and only here: the tests pin the *shape* of the scoring
 * (an absent signal is free, a worse page never scores lower, each channel
 * respects its cap) rather than the numbers, so these can move without
 * rewriting the suite.
 */
export const WEIGHTS = {
  // 2% is the noise floor `dev-compare` already uses to decide a section is
  // worth printing; below it the difference is antialiasing and scrollbars.
  pixel: { floorPct: 2, slope: 2.2, cap: 40 },
  // The heaviest per-finding channel, deliberately. A missing photo is exactly
  // what a person spots in a screenshot in half a second and what every
  // text-based check here is blind to.
  droppedImages: { base: 12, each: 4, max: 5, cap: 32 },
  droppedContent: { base: 8, each: 2, max: 8, cap: 24 },
  duplicatedContent: { base: 6, each: 2, max: 5, cap: 16 },
  headingCount: { none: 12, extra: 6, cap: 12 },
  pattern: { missing: 10, partial: 4, cap: 24 },
  smell: { each: 5, cap: 12 },
  verify: { each: 3, max: 6, cap: 18 },
  repeat: { each: 6, cap: 12 },
  icons: { fuzzy: 3, unresolved: 5, cap: 10 },
  emptyish: { each: 9, cap: 18 },
  missingAssets: { base: 5, each: 3, max: 5, cap: 15 },
  oneOff: { each: 4, inFamily: 2, cap: 14 },
};

/** Score bands, checked high to low. `band` is what the report shows. */
export const BANDS = [
  { min: 60, band: "high" },
  { min: 25, band: "medium" },
  { min: 0, band: "low" },
];

export const DEFAULT_THRESHOLD = 25;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** The band a score falls in. */
export function bandFor(score) {
  return (BANDS.find((b) => score >= b.min) || BANDS[BANDS.length - 1]).band;
}

/**
 * Hints for the signals that have no finding of their own to borrow prose from.
 *
 * Everything sourced from `content-coverage.mjs` or `layout-patterns.mjs` keeps
 * that module's `label` and `hint` verbatim — those sentences are the most
 * useful part of the output and re-wording them here would mean two versions of
 * the same advice drifting apart. Only the channels invented by this module
 * need their own.
 */
const OWN_HINTS = {
  pixel: {
    label: "Whole-page pixel mismatch",
    hint: "A large mismatch together with a large height delta usually means a whole section is missing rather than mis-styled — check the coverage reasons before chasing CSS.",
  },
  verify: {
    label: "Text rendered at the wrong size or in the wrong family",
    hint: "`dev-verify` pairs source and built elements by their text; a severe finding is one where the size or family differs enough to change the page's reading order.",
  },
  repeat: {
    label: "Repeat block detected with low confidence",
    hint: "The generator guessed at where one card ends and the next begins. Check the repeated items rendered with the right boundaries and that none were absorbed into a sibling.",
  },
  icons: {
    label: "Icons matched approximately or not at all",
    hint: "A fuzzy match picked the nearest name in the icon set; an unresolved one rendered nothing. Compare the icons against the original before trusting them.",
  },
  emptyish: {
    label: "Section has markup but no content props",
    hint: "The emitter kept the section's structure and typography but gave its text no prop, so it renders styled and empty. This is the shape of a dropped heading.",
  },
  missingAssets: {
    label: "Referenced assets absent from the snapshot",
    hint: "The generated output points at files the mirror never captured, so they cannot be copied into the build. Usually a background image only reachable through the live CSS.",
  },
  oneOff: {
    label: "Bespoke component used by only this page",
    hint: "A one-off, especially one in a large near-identical family, is usually a hand-forked copy. Fixing it here will not fix its siblings — check whether the fix belongs in a shared component instead.",
  },
};

/** Build one reason record, dropping the empty fields so the JSON stays legible. */
function reason(id, source, points, detail, { label, hint, examples, where } = {}) {
  const meta = OWN_HINTS[id] || {};
  const out = {
    id,
    source,
    points: Math.round(points),
    label: label || meta.label || id,
    detail,
  };

  const text = hint || meta.hint;
  if (text) out.hint = text;
  if (examples?.length) out.examples = examples.slice(0, 5);
  if (where && Object.keys(where).length) out.where = where;
  return out;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The pixel channel.
 *
 * `pixel` is keyed by viewport width, as `comparePngs` returns it. The worst
 * viewport decides — a page that is perfect at 1440 and broken at 390 is a
 * broken page, and averaging the two would hide it.
 */
function pixelReason(pixel) {
  if (!pixel) return null;

  const entries = Object.entries(pixel).filter(([, v]) => v && typeof v.ratio === "number");
  if (entries.length === 0) return null;

  let worstWidth = null;
  let worst = null;

  for (const [width, v] of entries) {
    if (!worst || v.ratio > worst.ratio) {
      worst = v;
      worstWidth = Number(width);
    }
  }

  const pct = worst.ratio * 100;
  const { floorPct, slope, cap } = WEIGHTS.pixel;
  const points = clamp((pct - floorPct) * slope, 0, cap);
  if (points === 0) return null;

  const delta = Math.round(worst.heightDelta || 0);
  const height = delta
    ? `; the build is ${Math.abs(delta)}px ${delta < 0 ? "shorter" : "taller"} than the source`
    : "";

  return reason(
    "pixel",
    "pixel",
    points,
    `${pct.toFixed(1)}% of pixels differ at ${worstWidth}px${height}`,
    {
      where: { viewport: worstWidth },
    }
  );
}

/** Coverage and layout-pattern findings, which already carry their own prose. */
function findingReasons(findings) {
  const out = [];

  for (const f of findings || []) {
    const carry = { label: f.label, hint: f.hint, examples: f.examples };

    if (f.kind === "coverage") {
      const n = f.builtCount || 0;

      if (f.id === "droppedImages") {
        const w = WEIGHTS.droppedImages;
        out.push(
          reason(
            "droppedImages",
            "coverage",
            clamp(w.base + w.each * Math.min(n, w.max), 0, w.cap),
            `${plural(n, "image")} in the source and absent from the build`,
            carry
          )
        );
      } else if (f.id === "droppedContent") {
        const w = WEIGHTS.droppedContent;
        out.push(
          reason(
            "droppedContent",
            "coverage",
            clamp(w.base + w.each * Math.min(n, w.max), 0, w.cap),
            `${plural(n, "block")} of text the build never renders`,
            carry
          )
        );
      } else if (f.id === "duplicatedContent") {
        const w = WEIGHTS.duplicatedContent;
        out.push(
          reason(
            "duplicatedContent",
            "coverage",
            clamp(w.base + w.each * Math.min(n, w.max), 0, w.cap),
            `${plural(n, "block")} of text rendered more than once`,
            carry
          )
        );
      } else if (f.id === "headingCount") {
        const w = WEIGHTS.headingCount;
        out.push(
          reason(
            "headingCount",
            "coverage",
            n === 0 ? w.none : w.extra,
            n === 0 ? "the build renders no <h1>" : `the build renders ${n} <h1> elements`,
            carry
          )
        );
      }
      continue;
    }

    if (f.kind === "pattern") {
      // `kept` is not a defect. `partial` is scored low rather than dropped:
      // `actionableFindings` filters it out of the to-do list, but the whole
      // point of ranking every page is that a weak signal still breaks a tie.
      const w = WEIGHTS.pattern;
      const points = f.status === "missing" ? w.missing : f.status === "partial" ? w.partial : 0;
      if (points === 0) continue;

      out.push(
        reason(f.id, "pattern", points, `source ${f.sourceCount}, built ${f.builtCount}`, carry)
      );
      continue;
    }

    if (f.kind === "smell") {
      out.push(
        reason(f.id, "smell", WEIGHTS.smell.each, `${plural(f.builtCount || 0, "hit")}`, carry)
      );
    }
  }

  // Cap per channel, not per finding: several `missing` patterns on one page
  // stack up to the cap and no further.
  return capByChannel(out, { pattern: WEIGHTS.pattern.cap, smell: WEIGHTS.smell.cap });
}

/**
 * Hold each named channel's total to its cap, scaling its reasons down in
 * proportion so the per-reason `points` still sum to exactly what the score
 * used — the report has to add up, or the numbers next to each reason are
 * decoration rather than an explanation.
 *
 * The remainder is distributed largest-first rather than rounded per reason:
 * rounding each share independently is what turns forty findings sharing a
 * 24-point cap into forty ones, forty points, and a cap that does not hold.
 */
function capByChannel(reasons, caps) {
  for (const [source, cap] of Object.entries(caps)) {
    const inChannel = reasons.filter((r) => r.source === source);
    const total = inChannel.reduce((n, r) => n + r.points, 0);
    if (total <= cap) continue;

    const shares = inChannel.map((r) => (r.points * cap) / total);
    const floors = shares.map(Math.floor);
    let left = cap - floors.reduce((n, f) => n + f, 0);

    // Whoever lost most to the floor gets the leftover points back first.
    const order = shares
      .map((share, i) => ({ i, frac: share - floors[i] }))
      .sort((a, b) => b.frac - a.frac);

    for (const { i } of order) {
      inChannel[i].points = floors[i] + (left > 0 ? 1 : 0);
      if (left > 0) left -= 1;
    }
  }
  return reasons;
}

/**
 * The generation-time uncertainty channels.
 *
 * Returns `[]` for a null record — not a penalty. See the module header.
 */
function uncertaintyReasons(uncertainty) {
  if (!uncertainty) return [];

  const out = [];
  const sections = uncertainty.sections || [];

  const lowRepeats = sections.filter((s) => s.repeat?.confidence === "low");
  if (lowRepeats.length) {
    const w = WEIGHTS.repeat;
    out.push(
      reason(
        "repeat",
        "uncertainty",
        clamp(w.each * lowRepeats.length, 0, w.cap),
        `${plural(lowRepeats.length, "section")} whose repeat boundaries were guessed`,
        {
          examples: lowRepeats.map((s) => `${s.component} (${s.repeat.itemCount}x)`),
          where: lowRepeats.length === 1 ? sectionWhere(lowRepeats[0]) : undefined,
        }
      )
    );
  }

  const fuzzy = sections.flatMap((s) => (s.icons?.fuzzy || []).map((n) => ({ s, n })));
  const unresolved = sections.flatMap((s) => (s.icons?.unresolved || []).map((n) => ({ s, n })));
  if (fuzzy.length || unresolved.length) {
    const w = WEIGHTS.icons;
    out.push(
      reason(
        "icons",
        "uncertainty",
        clamp(w.fuzzy * fuzzy.length + w.unresolved * unresolved.length, 0, w.cap),
        [
          fuzzy.length && `${plural(fuzzy.length, "icon")} matched approximately`,
          unresolved.length && `${plural(unresolved.length, "icon")} unresolved`,
        ]
          .filter(Boolean)
          .join(", "),
        { examples: [...unresolved, ...fuzzy].map((x) => `${x.n} in ${x.s.component}`) }
      )
    );
  }

  const empty = sections.filter((s) => s.emptyish);
  if (empty.length) {
    const w = WEIGHTS.emptyish;
    out.push(
      reason(
        "emptyish",
        "uncertainty",
        clamp(w.each * empty.length, 0, w.cap),
        `${plural(empty.length, "section")} with markup and no content props`,
        {
          examples: empty.map((s) => s.component),
          where: empty.length === 1 ? sectionWhere(empty[0]) : undefined,
        }
      )
    );
  }

  const missing = uncertainty.pageLevel?.missingAssets || [];
  if (missing.length) {
    const w = WEIGHTS.missingAssets;
    out.push(
      reason(
        "missingAssets",
        "uncertainty",
        clamp(w.base + w.each * Math.min(missing.length, w.max), 0, w.cap),
        `${plural(missing.length, "asset")} referenced but absent from the snapshot`,
        { examples: missing }
      )
    );
  }

  return out;
}

function sectionWhere(section) {
  const where = {};
  if (section.sectionIndex != null) where.sectionIndex = section.sectionIndex;
  if (section.component) where.component = section.component;
  return where;
}

/**
 * The registry channel — the retroactive stand-in for generation-time
 * uncertainty.
 *
 * A component used by exactly one page is a bespoke one-off, and one that also
 * belongs to a group of near-identical siblings is almost certainly a hand-fork
 * of a shared shape. Both facts come out of `.wpmig/components.json` and
 * `duplicateFamilies()`, which exist for pages generated long before any of
 * this — which is what makes this channel usable on a migration already done.
 */
function registryReasons(registryFacts) {
  const oneOffs = registryFacts?.oneOffComponents || [];
  if (oneOffs.length === 0) return [];

  const inFamily = new Set(registryFacts.familyMembers || []);
  const w = WEIGHTS.oneOff;
  const points = clamp(
    oneOffs.reduce((n, k) => n + w.each + (inFamily.has(k) ? w.inFamily : 0), 0),
    0,
    w.cap
  );

  const forked = oneOffs.filter((k) => inFamily.has(k));
  const detail = forked.length
    ? `${plural(oneOffs.length, "component")} used by this page alone, ${forked.length} of them in a near-identical family`
    : `${plural(oneOffs.length, "component")} used by this page alone`;

  return [reason("oneOff", "registry", points, detail, { examples: oneOffs })];
}

/**
 * Images every page's source references and no page's build has.
 *
 * A theme's decorations reach the page through live CSS — a preloader spinner,
 * a body-background flourish — so a mirrored snapshot references them and the
 * build never does, on every page at once. Counted as dropped content they add
 * the same points to every page, which is not a ranking; it is a constant that
 * pushes half a site over the threshold and buries the pages with a real defect
 * beneath the pages with none.
 *
 * `content-coverage.mjs` already masks phone numbers and logos for exactly this
 * reason. This is the same judgement made where the whole corpus is visible:
 * an image absent from *every* build is a property of the theme, not of any
 * page. The threshold is deliberately "almost all" rather than "all", since one
 * page that happens to render the spinner should not restore the noise
 * everywhere.
 *
 * Returns the set of image keys to disregard, given every page's coverage.
 */
/**
 * Decoration a *single* page cannot prove is decoration.
 *
 * The corpus test below needs several pages to conclude anything, so a one-page
 * run (`--pages <slug>`, the fast iteration loop) has no way to recognise the
 * theme's own furniture and reports it as missing content. These are the shapes
 * a WordPress theme paints from live CSS: a preloader spinner, a body-background
 * flourish. Naming them is a smaller lie than reporting them as page content on
 * every single-page run.
 */
const KNOWN_DECORATION = /^(spin|body|bg|preload|loader|overlay)[-_]?(wh|bg|img)?$/i;

export function ubiquitousMissingImages(perPageMissing, { pages, minShare = 0.9 } = {}) {
  const total = pages ?? perPageMissing.length;
  if (total < 3) {
    const out = new Set();
    for (const missing of perPageMissing) {
      for (const key of missing || []) if (KNOWN_DECORATION.test(key)) out.add(key);
    }
    return out;
  }

  const seen = new Map();
  for (const missing of perPageMissing) {
    for (const key of new Set(missing || [])) seen.set(key, (seen.get(key) || 0) + 1);
  }

  const out = new Set();
  for (const [key, n] of seen) {
    if (n / total >= minShare) out.add(key);
  }
  return out;
}

/**
 * Score one page.
 *
 * Every input is optional and every absent input is worth zero, so a caller
 * that has only run half the checks still gets a usable ranking of what it did
 * run — it just needs to say so in the report (`scoredWithout`).
 *
 * @param {object} input
 * @param {string} input.slug
 * @param {string} [input.route]
 * @param {Array}  [input.findings]       coverage + layout-pattern findings
 * @param {Array}  [input.verifyFindings] raw `dev-verify` findings (severe are filtered by the caller)
 * @param {object} [input.pixel]          `{ [width]: { ratio, heightDelta } }`, or null
 * @param {object} [input.uncertainty]    parsed `.wpmig/uncertainty/<slug>.json`, or null
 * @param {object} [input.registryFacts]  `{ oneOffComponents: [], familyMembers: [] }`
 * @param {object} [opts]
 * @param {number} [opts.threshold]
 */
export function scorePage(input, opts = {}) {
  const { slug, route = "", findings = [], verifyFindings = [], pixel = null } = input;
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;

  const reasons = [];

  const px = pixelReason(pixel);
  if (px) reasons.push(px);

  reasons.push(...findingReasons(findings));

  if (verifyFindings.length) {
    const w = WEIGHTS.verify;
    reasons.push(
      reason(
        "verify",
        "verify",
        clamp(w.each * Math.min(verifyFindings.length, w.max), 0, w.cap),
        `${plural(verifyFindings.length, "element")} rendered at a size or in a family that changes the reading order`,
        {
          examples: verifyFindings.slice(0, 5).map((f) => {
            const size = f.diffs?.find((d) => d.prop === "fontSize");
            return size
              ? `"${excerpt(f.key)}" ${size.source} -> ${size.built}`
              : `"${excerpt(f.key)}"`;
          }),
        }
      )
    );
  }

  reasons.push(...uncertaintyReasons(input.uncertainty));
  reasons.push(...registryReasons(input.registryFacts));

  reasons.sort((a, b) => b.points - a.points);

  const score = clamp(Math.round(reasons.reduce((n, r) => n + r.points, 0)), 0, 100);

  return {
    slug,
    route,
    score,
    band: bandFor(score),
    flagged: score >= threshold,
    reasons,
    uncertaintyAvailable: Boolean(input.uncertainty),
  };
}

const excerpt = (k) => (String(k).length > 48 ? `${String(k).slice(0, 45)}…` : String(k));

/**
 * Sort scored pages worst-first and re-apply the flag threshold.
 *
 * Ties break on slug so two runs over unchanged input produce the same order —
 * a report whose rows shuffle between runs is one nobody can diff.
 */
export function rankPages(scored, { threshold = DEFAULT_THRESHOLD } = {}) {
  return [...scored]
    .map((p) => ({ ...p, flagged: p.score >= threshold, band: bandFor(p.score) }))
    .sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug))
    .map((p, i) => ({ ...p, rank: i + 1 }));
}
