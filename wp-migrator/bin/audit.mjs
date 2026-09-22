/**
 * `wpmig dev-audit` — everything about a migrated page that `dev-verify` is
 * structurally unable to see.
 *
 * `dev-verify` pairs source and built elements by their text and diffs
 * typography. That is the right key for what it does, and it is blind by
 * construction to three whole classes of defect:
 *
 *   - **Structure.** A section says the same words at the same size whether or
 *     not it kept its parallax background, its overlay header, its half-screen
 *     photo column or its hover captions (`src/qa/layout-patterns.mjs`).
 *   - **Coverage.** An unpaired element is skipped, so text that exists on only
 *     one side — a section the build never renders, or one it renders twice —
 *     produces no finding at all (`src/qa/content-coverage.mjs`).
 *   - **The component set.** Every page can render exactly what its own
 *     component says while the *set* of components is wrong: one section
 *     emitted seven times, or two components claiming one class prefix
 *     (`src/qa/component-hygiene.mjs`).
 *
 * Each module documents the specific defect on this migration that motivated
 * it. Findings are only reported where the source has something the build does
 * not, so the output is a to-do list rather than an inventory.
 */

import fs from "node:fs";
import path from "node:path";
import { defineCommand } from "citty";
import { chromium } from "playwright";
import { serve } from "../src/mirror/serve.mjs";
import { gotoStable } from "../src/browser/load.mjs";
import { loadRouteMap } from "../src/snapshot/routes.mjs";
import {
  DETECT_PATTERNS,
  DETECT_SMELLS,
  comparePatterns,
  actionableFindings,
} from "../src/qa/layout-patterns.mjs";
import { READ_CONTENT, diffCoverage, coverageFindings } from "../src/qa/content-coverage.mjs";
import {
  migratedComponents,
  prefixCollisions,
  duplicateFamilies,
  hoverFillOnInvisibleOverlay,
} from "../src/qa/component-hygiene.mjs";

/** Report the checks that read the component files rather than a render. */
function reportHygiene(compRoot, { quiet = false } = {}) {
  const components = migratedComponents(compRoot);
  const collisions = prefixCollisions(components);
  const families = duplicateFamilies(components);
  const hoverFills = hoverFillOnInvisibleOverlay(components);

  if (quiet) return { components, collisions, families, hoverFills };

  console.log(`\ncomponents: ${components.length} written by the migrator`);

  if (collisions.length) {
    console.log(`\n  ${collisions.length} class prefix(es) claimed by more than one component:`);
    for (const { prefix, files } of collisions) console.log(`    .${prefix}-* — ${files.join(", ")}`);
    console.log(
      "    -> Astro scoping hides this at render time, but dev-refix maps a class to one owner and will correct the wrong component."
    );
  }

  if (families.length) {
    const total = families.reduce((n, g) => n + g.length, 0);

    console.log(`\n  ${families.length} group(s) of near-identical components (${total} files):`);
    for (const group of families.slice(0, 12)) console.log(`    ${group.join(", ")}`);
    console.log(
      "    -> One section emitted once per page family. Fix it in one place and make the rest pass through, or run collapse-families.mjs — otherwise every fix has to be found and repeated."
    );
  }

  if (hoverFills.length) {
    console.log(`\n  ${hoverFills.length} invisible overlay(s) that paint on hover:`);
    for (const h of hoverFills.slice(0, 8)) console.log(`    ${h.name} .${h.cls} -> ${h.fill}`);
    console.log(
      "    -> A full-bleed link held at opacity 0 is a hit target; the captured :hover fill covers the whole card. It must stay invisible."
    );
  }

  return { components, collisions, families, hoverFills };
}

export const devAudit = defineCommand({
  meta: {
    name: "dev-audit",
    description: "Report layout, coverage and component-set defects dev-verify cannot see.",
  },
  args: {
    static: { type: "string", description: "Snapshot directory", default: "" },
    dist: { type: "string", description: "Built site directory", default: "" },
    components: { type: "string", description: "Components root", default: "" },
    pages: { type: "string", description: "Comma-separated page slugs (default: all)", default: "" },
    width: { type: "string", description: "Viewport width to audit at", default: "1440" },
    all: { type: "boolean", description: "Include patterns the build kept", default: false },
    "components-only": { type: "boolean", description: "Skip the per-page render checks", default: false },
    json: { type: "string", description: "Write full findings to this file", default: "" },
  },
  async run({ args }) {
    const here = path.dirname(new URL(import.meta.url).pathname);
    const staticDir = path.resolve(args.static || path.join(here, "../.wpmig/static"));
    const distDir = path.resolve(args.dist || path.join(here, "../../dist"));
    const compRoot = path.resolve(args.components || path.join(here, "../../src/components"));

    const hygiene = reportHygiene(compRoot);

    if (args["components-only"]) return;

    if (!fs.existsSync(staticDir)) throw new Error(`snapshot dir not found: ${staticDir}`);
    if (!fs.existsSync(distDir)) throw new Error(`dist not found: ${distDir} — run a build first`);

    const routes = loadRouteMap(staticDir);
    const wanted = args.pages ? new Set(args.pages.split(",").map((s) => s.trim())) : null;
    const width = parseInt(args.width, 10) || 1440;

    const slugs = fs
      .readdirSync(staticDir)
      .filter((f) => f.endsWith(".html"))
      .map((f) => f.replace(/\.html$/, ""))
      .filter((slug) => routes.has(slug))
      .filter((slug) => !wanted || wanted.has(slug))
      .sort();

    const src = await serve(staticDir, 0);
    const blt = await serve(distDir, 0);
    const browser = await chromium.launch();
    const report = [];

    try {
      const page = await browser.newPage({ viewport: { width, height: 1200 } });

      for (const slug of slugs) {
        const route = routes.get(slug);
        const builtFile = path.join(distDir, route.replace(/^\//, ""), "index.html");

        if (!fs.existsSync(builtFile)) continue;

        // The source mirrors a lazy-loading theme, so prime it before reading:
        // a `data-bg` scrim or a `data-src` photo is invisible until it runs.
        const read = async (url, fns) => {
          const state = await gotoStable(page, url, { primeLazyLoad: true, reveal: true });

          if (!state.ok) return null;

          const out = [];
          for (const fn of fns) out.push(await page.evaluate(fn));
          return out;
        };

        const source = await read(`${src.url}/${slug}.html`, [DETECT_PATTERNS, READ_CONTENT]);
        const built = await read(`${blt.url}${route}`, [DETECT_PATTERNS, DETECT_SMELLS, READ_CONTENT]);

        if (!source || !built) {
          console.log(`  ${slug}: could not load, skipped`);
          continue;
        }

        const coverage = diffCoverage(source[1], built[2]);
        const findings = [
          ...comparePatterns(source[0], built[0], built[1]),
          ...coverageFindings(coverage),
        ];
        const shown = args.all ? findings : actionableFindings(findings);

        if (shown.length === 0) continue;
        report.push({ slug, route, findings });
        console.log(`\n${slug}`);

        for (const f of shown) {
          const counts =
            f.kind === "pattern"
              ? `source ${f.sourceCount}, built ${f.builtCount}`
              : `${f.builtCount} hit(s)`;

          console.log(`  [${f.status}] ${f.label}  (${counts})`);
          for (const example of f.examples) console.log(`      ${example}`);
          if (f.status !== "kept") console.log(`      -> ${f.hint}`);
        }
      }
    } finally {
      await browser.close();
      src.server.close();
      blt.server.close();
    }

    const actionable = report.reduce((n, r) => n + actionableFindings(r.findings).length, 0);
    const hygieneCount =
      hygiene.collisions.length + hygiene.families.length + hygiene.hoverFills.length;

    console.log(
      `\n${slugs.length} page(s) checked — ${report.length} with findings, ${actionable} actionable` +
        `${hygieneCount ? `, plus ${hygieneCount} component-set finding(s)` : ""}.`
    );
    if (args.json) {
      fs.writeFileSync(
        path.resolve(args.json),
        JSON.stringify({ pages: report, components: hygiene }, null, 2)
      );
      console.log(`full findings -> ${args.json}`);
    }
  },
});
