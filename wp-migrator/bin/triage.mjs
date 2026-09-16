/**
 * `wpmig dev-triage` — which pages need a human, in what order, with the
 * screenshots and file paths already laid out.
 *
 * Every other check here reports on a page you already chose to look at.
 * Choosing is the part that does not scale: with ninety mirrored pages, the
 * bottleneck is not diagnosing a page but knowing which one to open. And the
 * thing that actually finds the differences worth fixing is a person (or a
 * model) looking at the original and the rebuild side by side — a comparison no
 * DOM check makes, because the defects it catches are the ones nobody thought
 * to write a rule for.
 *
 * So this command does the mechanical half and stops:
 *
 *   1. Score every page from the checks that already exist (`layout-patterns`,
 *      `content-coverage`, an optional `dev-verify` artifact, the component
 *      registry, and a whole-page pixel diff).
 *   2. Rank worst-first, and add one representative page per navigation group
 *      so the queue spans the site's *kinds* of page rather than nine variants
 *      of the same service template.
 *   3. Screenshot original vs rebuild for the pages that survived, and write
 *      one report carrying the score, the reasons with their existing prose,
 *      the PNG paths, and the exact `.md`/`.astro` files to edit.
 *
 * It never edits anything and never calls a model. The judgement stays with
 * whoever reads the queue — which is the whole point of emitting one.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineCommand } from "citty";
import { chromium } from "playwright";
import { serve } from "../src/mirror/serve.mjs";
import { gotoStable } from "../src/browser/load.mjs";
import { loadRouteMap } from "../src/snapshot/routes.mjs";
import { capturePageShots } from "../src/capture/screenshot.mjs";
import { comparePngs } from "../src/qa/compare.mjs";
import { DETECT_PATTERNS, DETECT_SMELLS, comparePatterns } from "../src/qa/layout-patterns.mjs";
import { READ_CONTENT, diffCoverage, coverageFindings } from "../src/qa/content-coverage.mjs";
import { duplicateFamilies, migratedComponents } from "../src/qa/component-hygiene.mjs";
import { severeFindings } from "../src/qa/pair-by-text.mjs";
import {
  DEFAULT_THRESHOLD,
  rankPages,
  scorePage,
  ubiquitousMissingImages,
} from "../src/qa/triage.mjs";
import { mediaGap } from "../src/qa/missing-media.mjs";
import {
  indexRegistry,
  renderQueueMarkdown,
  resolveEditTargets,
  selectNavSample,
} from "../src/qa/queue.mjs";

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Fail before Chromium starts if the dev server is not up.
 *
 * `gotoStable` returns `{ok:false}` on a refused connection rather than
 * throwing, and `capturePageShots` turns that into a per-page error — so
 * without this check a stopped dev server produces ninety identical failures
 * instead of one sentence naming both ways out.
 */
async function preflightOrigin(origin, distDir) {
  const res = await fetch(origin, { signal: AbortSignal.timeout(5000) }).catch((err) => err);

  if (res instanceof Error || !res.ok) {
    throw new Error(
      `no site answering at ${origin} — start the dev server (\`npm run dev\`) and re-run, ` +
        `or drop --built-origin to screenshot ${distDir} instead.`
    );
  }
}

export const devTriage = defineCommand({
  meta: {
    name: "dev-triage",
    description:
      "Score every migrated page, screenshot the worst against the original, and write a work queue.",
  },
  args: {
    static: {
      type: "string",
      description: "Snapshot mirror directory",
      default: path.join(HERE, ".wpmig/static"),
    },
    dist: {
      type: "string",
      description: "Built site directory",
      default: path.join(HERE, "../dist"),
    },
    "built-origin": {
      type: "string",
      description: "Screenshot this origin instead of dist (e.g. http://localhost:4321)",
      default: "",
    },
    components: {
      type: "string",
      description: "Components root",
      default: path.join(HERE, "../src/components"),
    },
    content: {
      type: "string",
      description: "Content pages directory",
      default: path.join(HERE, "../src/content/pages"),
    },
    nav: {
      type: "string",
      description: "Main navigation JSON",
      default: path.join(HERE, "../src/data/mainNav.json"),
    },
    pages: {
      type: "string",
      description: "Comma-separated page slugs (default: all)",
      default: "",
    },
    viewports: {
      type: "string",
      description: "Comma-separated widths to capture",
      default: "1440,768,390",
    },
    threshold: {
      type: "string",
      description: "Score at or above which a page is flagged",
      default: String(DEFAULT_THRESHOLD),
    },
    limit: {
      type: "string",
      description: "Cap how many pages get screenshots (0 = uncapped)",
      default: "10",
    },
    all: {
      type: "boolean",
      description: "Put every scored page in the report, not just the queue",
      default: false,
    },
    "nav-sample": {
      type: "boolean",
      description: "Always include one page per nav group",
      default: true,
    },
    "verify-json": {
      type: "string",
      description: "A `dev-verify --json` artifact to fold in",
      default: "",
    },
    out: {
      type: "string",
      description: "Output directory for the queue and its screenshots",
      default: path.join(HERE, ".wpmig/triage"),
    },
    json: {
      type: "string",
      description: "Write an extra copy of the queue JSON here",
      default: "",
    },
    md: {
      type: "boolean",
      description: "Also write a human-readable queue.md index",
      default: false,
    },
    shots: {
      type: "boolean",
      description: "Capture screenshots (--no-shots scores only)",
      default: true,
    },
  },
  async run({ args }) {
    const staticDir = path.resolve(args.static);
    const distDir = path.resolve(args.dist);
    const outRoot = path.resolve(args.out);
    const origin = args["built-origin"].replace(/\/$/, "");
    const threshold = parseInt(args.threshold, 10) || DEFAULT_THRESHOLD;
    const limit = parseInt(args.limit, 10) || 0;
    const viewports = args.viewports
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter(Boolean);

    if (!fs.existsSync(staticDir)) throw new Error(`snapshot dir not found: ${staticDir}`);
    if (!origin && !fs.existsSync(distDir)) {
      throw new Error(
        `dist not found: ${distDir} — run a build first, or pass --built-origin http://localhost:4321`
      );
    }
    if (origin) await preflightOrigin(origin, distDir);

    const routes = loadRouteMap(staticDir);
    const wanted = args.pages
      ? new Set(
          args.pages
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        )
      : null;
    const slugs = fs
      .readdirSync(staticDir)
      .filter((f) => f.endsWith(".html"))
      .map((f) => f.replace(/\.html$/, ""))
      .filter((slug) => routes.has(slug))
      .filter((slug) => !wanted || wanted.has(slug))
      .sort();

    // Everything that is read once for the whole run, not once per page.
    const byKebab = indexRegistry(readJson(path.join(HERE, ".wpmig/components.json")) || {});
    const families = duplicateFamilies(migratedComponents(path.resolve(args.components)));
    const irDir = path.join(HERE, ".wpmig/ir");
    const verifyReport = args["verify-json"] ? readJson(path.resolve(args["verify-json"])) : null;
    const verifyBySlug = new Map(
      (Array.isArray(verifyReport) ? verifyReport : verifyReport?.pages || []).map((p) => [
        p.slug,
        p.findings || [],
      ])
    );

    const nav = readJson(path.resolve(args.nav));
    if (args["nav-sample"] && !nav?.navData) {
      console.warn(`nav sampling off: no navData in ${args.nav} — ranking by score alone.`);
    }

    const srcSrv = await serve(staticDir, 0);
    const bltSrv = origin ? null : await serve(distDir, 0);
    const builtBase = origin || bltSrv.url;
    const browser = await chromium.launch();

    let report;
    try {
      const page = await browser.newPage({
        viewport: { width: viewports[0] || 1440, height: 1200 },
      });

      // Pass one: score every page from the DOM checks. No screenshots yet —
      // capturing ninety pages to rank them would cost more than the ranking
      // saves, and the pixel channel only has to be right for the pages that
      // make the queue.
      const read = async (url, fns) => {
        const state = await gotoStable(page, url, { primeLazyLoad: true, reveal: true });
        if (!state.ok) return null;

        const out = [];
        for (const fn of fns) out.push(await page.evaluate(fn));
        return out;
      };

      const scored = [];

      for (const slug of slugs) {
        const route = routes.get(slug);
        const source = await read(`${srcSrv.url}/${slug}.html`, [DETECT_PATTERNS, READ_CONTENT]);
        const built = await read(`${builtBase}${route}`, [
          DETECT_PATTERNS,
          DETECT_SMELLS,
          READ_CONTENT,
        ]);

        if (!source || !built) {
          console.log(`  ${slug}: could not load, skipped`);
          continue;
        }

        const edit = resolveEditTargets({
          slug,
          contentDir: path.resolve(args.content),
          irDir,
          byKebab,
          componentsRoot: path.resolve(args.components),
          families,
        });

        const coverage = diffCoverage(source[1], built[2]);
        const findings = [
          ...comparePatterns(source[0], built[0], built[1]),
          ...coverageFindings(coverage),
        ];
        const verifyFindings = severeFindings(verifyBySlug.get(slug) || []);
        const uncertainty = readJson(path.join(HERE, ".wpmig/uncertainty", `${slug}.json`));

        // What the mirror holds that this page never rendered. Offline and
        // model-free: the crawler reaches a gallery's files through its
        // lightbox hrefs even when the markup that displays them never arrives
        // in a pre-JS snapshot, so unreferenced media is the fingerprint of
        // content the extractor could not see. Naming it here puts the question
        // in the queue for whoever reads the screenshots.
        // Read the references from the page the browser just rendered, not from
        // `dist/`: the fast loop runs against a dev server (`--built-origin`)
        // where no `dist/` exists, and reading it there would silently skip the
        // check on exactly the runs a person iterates with.
        const pageRefs = await page.evaluate(() =>
          [...document.querySelectorAll("[src], [href], [style]")].flatMap((el) => {
            const bits = [
              el.getAttribute("src"),
              el.getAttribute("href"),
              el.getAttribute("style"),
            ];
            return bits
              .filter(Boolean)
              .flatMap((v) =>
                [...String(v).matchAll(/\/wp-content\/uploads\/[^"'\s>)]+/g)].map((m) => m[0])
              );
          })
        );
        const gap = mediaGap({ staticDir, referenced: pageRefs, pageSlug: slug });

        scored.push({
          // Held for pass two: re-scoring with the pixel evidence has to see
          // the same inputs, or the score changes for reasons nobody asked
          // about.
          inputs: {
            slug,
            route,
            findings,
            verifyFindings,
            uncertainty,
            registryFacts: edit.registryFacts,
          },
          coverage,
          mediaGap: gap,
          patterns: { source: source[0], built: built[0], smells: built[1] },
          content: { source: source[1], built: built[2] },
          ...scorePage(
            {
              slug,
              route,
              findings,
              verifyFindings,
              uncertainty,
              registryFacts: edit.registryFacts,
            },
            { threshold }
          ),
          edit,
        });
      }

      // A second pass over the whole corpus, now that every page's coverage is
      // known: images missing from every build are the theme's, not any page's,
      // and scoring them per page ranks nothing. Dropping them here rather than
      // in the browser read keeps `diffCoverage` honest about what it saw.
      const ignoredImages = ubiquitousMissingImages(scored.map((p) => p.coverage.missingImages));

      if (ignoredImages.size) {
        console.log(
          `\nignoring ${ignoredImages.size} image(s) absent from every build — theme decoration, not page content: ` +
            `${[...ignoredImages].join(", ")}`
        );

        for (const p of scored) {
          const coverage = {
            ...p.coverage,
            missingImages: p.coverage.missingImages.filter((k) => !ignoredImages.has(k)),
          };
          const findings = [
            ...comparePatterns(p.patterns.source, p.patterns.built, p.patterns.smells),
            ...coverageFindings(coverage),
          ];

          p.inputs = { ...p.inputs, findings };
          Object.assign(p, scorePage(p.inputs, { threshold }), {
            inputs: p.inputs,
            edit: p.edit,
            coverage,
          });
        }
      }

      const ranked = rankPages(scored, { threshold });
      const navSample =
        args["nav-sample"] && nav?.navData
          ? selectNavSample({ navData: nav.navData, routes, scored: ranked })
          : new Map();

      for (const p of ranked) {
        const sample = navSample.get(p.slug);
        if (sample) p.navSample = sample;
      }

      // The queue is the flagged pages plus the nav representatives — a page
      // below threshold that is here only for coverage stays marked as such, so
      // nobody wonders why a clean page is in the list.
      //
      // Candidates for *capture* are deliberately wider than that. The pixel
      // channel can only score a page that was screenshotted, so selecting what
      // to screenshot by a score that does not yet include pixels is circular:
      // a page whose only defect is visual scores zero from the DOM checks,
      // never gets captured, and never surfaces — which is precisely the defect
      // class this command exists to catch. So the top of the ranking is
      // captured whether or not it flagged, and the queue is decided *after*
      // the pixel evidence exists.
      // Anything already flagged or sampled must be captured; beyond that, fill
      // the remaining budget from the top of the ranking so a page the DOM
      // checks found nothing wrong with still gets its screenshots taken.
      const budget = limit > 0 ? limit : ranked.length;
      const mustCapture = ranked.filter((p) => p.flagged || p.navSample);
      const capped = [...new Set([...mustCapture, ...ranked])].slice(0, budget);

      // Pass two: screenshots, and the pixel channel that needs them.
      if (args.shots) {
        for (const p of capped) {
          const slugOut = path.join(outRoot, p.slug);

          try {
            const originalShots = await capturePageShots(
              page,
              `${srcSrv.url}/${p.slug}.html`,
              slugOut,
              {
                prefix: "original",
                viewports,
              }
            );
            const builtShots = await capturePageShots(page, `${builtBase}${p.route}`, slugOut, {
              prefix: "built",
              viewports,
            });

            const shots = {};
            const pixel = {};

            for (const width of viewports) {
              const orig = originalShots.find((s) => s.width === width);
              const blt = builtShots.find((s) => s.width === width);
              if (!orig || !blt) continue;

              const diffFile = path.join(slugOut, `diff@${width}.png`);
              const result = comparePngs(orig.file, blt.file, diffFile);

              pixel[width] = { ratio: result.ratio, heightDelta: result.heightDelta };
              shots[width] = {
                original: orig.file,
                built: blt.file,
                diff: diffFile,
                pixelRatio: Number(result.ratio.toFixed(4)),
                heightDelta: result.heightDelta,
              };
            }

            p.shots = Object.keys(shots).length ? shots : null;

            // Re-score from the same inputs plus the pixel evidence, rather
            // than adding to the old score: the caps are per channel and the
            // clamp is on the total, so a score assembled in two passes is not
            // the score those inputs are worth.
            Object.assign(p, scorePage({ ...p.inputs, pixel }, { threshold }));
          } catch (err) {
            p.shots = null;
            p.captureError = err.message;
            console.error(`  ${p.slug}: capture failed — ${err.message}`);
          }
        }
      }

      // Re-rank once more so a page the pixel channel pushed up moves with it,
      // and only now decide what belongs in the queue — this is the point where
      // every channel has contributed.
      /**
       * Should this page carry the "did the extractor miss a gallery?" question?
       *
       * Not gated on `droppedImages`. That check compares the source DOM to the
       * built DOM, and the case worth asking about — a JS-rendered carousel — is
       * in **neither**: the images exist only in the rendered screenshot, so the
       * deterministic checks are silent by construction. Gating on them would
       * ask the question everywhere except where it matters.
       *
       * The real signal is a page holding a section that renders no images at
       * all while the site's mirror holds pictures nothing references. That is
       * cheap, offline, and true exactly where a slider or gallery was lost.
       */
      const shouldAskAboutMedia = (page, gap) => {
        if (!gap || gap.count === 0) return false;
        const f = page.reasons?.find((r) => r.id === "droppedImages");
        // A dropped-image finding that survives the decoration filter is a real
        // one, and the unreferenced pool is the evidence for answering it.
        if (f && (f.examples || []).some((e) => !ignoredImages.has(e))) return true;
        // Otherwise ask wherever the mirror holds pictures whose names match
        // this page. Anything broader fires on every page (the pool is
        // site-wide) and ranks nothing.
        return gap.named.length > 0;
      };

      const forReport = ({ inputs, coverage, patterns, content, mediaGap: g, ...page }) => ({
        ...page,
        // Only the actionable part reaches the report: a slug-matched filename
        // is a question someone can answer at a glance, whereas the full
        // unreferenced list is site-wide noise repeated on every page.
        // Attached only where the page *also* has a coverage finding about
        // dropped images. On its own, "the mirror holds files this page does
        // not use" is true of every page on every site — the unreferenced pool
        // is site-wide. It becomes a question worth asking only when something
        // already says this page is missing pictures, and then the pool is the
        // evidence for answering it.
        // Gated on a *coverage* finding about images — but `droppedImages`
        // alone is not enough: on a single-page run the corpus filter that
        // removes theme decoration (`spin_wh`) has too few pages to generalise
        // from, so the finding can be pure noise. Requiring that its examples
        // survive that filter keeps the question tied to real missing pictures.
        ...(shouldAskAboutMedia(page, g)
          ? {
              mediaGap: {
                namedForThisPage: g.named,
                unreferencedTotal: g.count,
                candidates: g.named.length ? g.named : g.candidates.slice(0, 12),
                question:
                  "This page is missing images, and the mirror holds files no page references. Open the original " +
                  "screenshot: if the missing pictures are visible there, the extractor could not see them (a JS " +
                  "gallery, a slider) and the files above are the candidates. If they are NOT visible, the source " +
                  "never published them — add nothing.",
              },
            }
          : {}),
      });
      const withPixels = rankPages(capped, { threshold });
      const finalOrder = withPixels
        .filter((p) => args.all || p.flagged || p.navSample)
        .map((p) => ({
          ...forReport(p),
          urls: {
            original: `${srcSrv.url}/${p.slug}.html`,
            built: `${builtBase}${p.route}`,
          },
        }));

      const jsonPath = path.join(outRoot, "queue.json");

      report = {
        generatedAt: new Date().toISOString(),
        tool: "wpmig dev-triage",
        jsonPath,
        builtFrom: origin ? { kind: "dev-server", origin } : { kind: "dist", dir: distDir },
        sourceFrom: { kind: "mirror", dir: staticDir },
        viewports,
        threshold,
        scoredWithout: args.shots ? [] : ["pixel"],
        ignoredImages: [...ignoredImages],
        howToUse:
          "Work top to bottom. For each page, Read the original and built PNGs side by side, then read `reasons` — " +
          "each carries the hint from the check that raised it. Edit the files under `edit`: copy and content live in " +
          "the .md, layout and colour in the .astro, and `usedByPages` says how many other pages that component " +
          "renders. Re-run `wpmig dev-triage --pages <slug>` to confirm. Never edit files under wp-migrator/. " +
          "Where a page carries `mediaGap`, answer its question from the screenshot before editing anything: content " +
          "missing from the build is sometimes content the source never published, and adding it would be invention.",
        counts: {
          scored: ranked.length,
          flagged: withPixels.filter((p) => p.flagged).length,
          navSampled: navSample.size,
          queued: finalOrder.length,
          captured: capped.filter((p) => p.shots).length,
        },
        pages: args.all ? rankPages(ranked, { threshold }).map(forReport) : finalOrder,
      };

      fs.mkdirSync(outRoot, { recursive: true });
      fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
      if (args.json) fs.writeFileSync(path.resolve(args.json), JSON.stringify(report, null, 2));
      if (args.md) fs.writeFileSync(path.join(outRoot, "queue.md"), renderQueueMarkdown(report));
    } finally {
      await browser.close();
      srcSrv.server.close();
      bltSrv?.server.close();
    }

    console.log("");
    for (const p of report.pages) {
      const top = p.reasons[0];
      const tag = p.navSample && !p.flagged ? "  (nav sample)" : "";

      console.log(
        `${String(p.rank).padStart(3)}. ${String(p.score).padStart(3)} ${p.band.padEnd(6)} ${p.slug}${tag}`
      );
      if (top) console.log(`      ${top.label} — ${top.detail}`);
    }

    const { scored, flagged, navSampled, captured } = report.counts;
    console.log(
      `\n${scored} page(s) scored, ${flagged} flagged, ${navSampled} nav representative(s), ${captured} captured.`
    );
    if (report.scoredWithout.length)
      console.log(`Scored without: ${report.scoredWithout.join(", ")}.`);
    console.log(`\nqueue -> ${report.jsonPath}`);
  },
});
