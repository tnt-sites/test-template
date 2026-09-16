/**
 * Site-wide refine.
 *
 * `dev-refine` is per page, and each of its passes rebuilds the whole site — at
 * one page that is the right trade, at eighty-six it is hours of rebuilding the
 * same output. The measurement is per page but the *build* is not, so this
 * inverts the loop: measure every page against one build, plan every page's
 * corrections, apply them all, rebuild once, measure again.
 *
 * The correction pass measures geometry and typography only (no screenshots) —
 * corrections are planned from those findings, never from a pixel ratio, so the
 * screenshots are pure cost here. The verification pass takes them for a sample
 * so the reported numbers are still pixel-based.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defineCommand } from "citty";
import { runCompare } from "./compare.mjs";
import {
  planCorrections,
  applyCorrections,
  mergePlan,
  loadState,
  saveState,
} from "../src/refine/index.mjs";

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function pagesFromIr() {
  const dir = path.join(HERE, ".wpmig/ir");
  if (!fs.existsSync(dir)) throw new Error(`no IR at ${dir} — run \`wpmig dev-page\` first`);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}

function countDecls(plan) {
  let n = 0;
  for (const entry of plan.values()) {
    for (const sels of entry.base.values()) n += sels.size;
    for (const media of entry.media.values()) for (const sels of media.values()) n += sels.size;
  }
  return n;
}

/**
 * Merge every page's plan into one, keeping a declaration only where it cannot
 * misrepresent another page: the component is used by a single page, or every
 * page using it measured the same value.
 */
function reconcilePlans(plans) {
  // component -> bucket -> selector -> property -> Map(value -> Set(pages))
  const votes = new Map();
  for (const [slug, plan] of plans) {
    for (const [comp, entry] of plan) {
      const compVotes = votes.get(comp) ?? new Map();
      votes.set(comp, compVotes);
      const record = (bucket, sel, prop, value) => {
        const key = `${bucket}\u0000${sel}\u0000${prop}`;
        const byValue = compVotes.get(key) ?? new Map();
        compVotes.set(key, byValue);
        const pagesFor = byValue.get(value) ?? new Set();
        byValue.set(value, pagesFor);
        pagesFor.add(slug);
      };
      for (const [sel, decls] of entry.base)
        for (const [prop, value] of decls) record("base", sel, prop, value);
      for (const [width, sels] of entry.media) {
        for (const [sel, decls] of sels)
          for (const [prop, value] of decls) record(String(width), sel, prop, value);
      }
    }
  }

  const global = new Map();
  let dropped = 0;
  for (const [comp, compVotes] of votes) {
    const entry = { base: new Map(), media: new Map() };
    for (const [key, byValue] of compVotes) {
      const [bucket, sel, prop] = key.split("\u0000");
      // One measured value and no other page measuring a different one: apply
      // it. Requiring every sharing page to have measured it too was tempting
      // but wrong — a page with no finding for a declaration is not disagreeing
      // about it, it simply had nothing to correct there, and demanding its
      // vote threw away most of the corrections the pages actually earned.
      // A second, different value is a real disagreement: neither wins.
      const value = byValue.size === 1 ? [...byValue.keys()][0] : null;
      if (value == null) {
        dropped++;
        continue;
      }
      const sels =
        bucket === "base"
          ? entry.base
          : (entry.media.get(Number(bucket)) ??
            entry.media.set(Number(bucket), new Map()).get(Number(bucket)));
      const decls = sels.get(sel) ?? new Map();
      sels.set(sel, decls);
      decls.set(prop, value);
    }
    const any = entry.base.size || [...entry.media.values()].some((m) => m.size);
    if (any) global.set(comp, entry);
  }
  return { global, dropped };
}

export const devRefineAll = defineCommand({
  meta: {
    name: "dev-refine-all",
    description:
      "Measure every generated page against one build, correct them all, rebuild, re-measure.",
  },
  args: {
    pages: {
      type: "string",
      description: "Comma-separated page slugs (default: every page with an IR)",
      default: "",
    },
    static: {
      type: "string",
      description: "Snapshot directory",
      default: path.join(HERE, ".wpmig/static"),
    },
    dist: {
      type: "string",
      description: "Built Astro output",
      default: path.join(HERE, "../dist"),
    },
    target: { type: "string", description: "Target repo root", default: path.join(HERE, "..") },
    namespace: { type: "string", description: "Generated component namespace", default: "wpmig" },
    viewports: { type: "string", description: "Comma-separated widths", default: "1440,768,390" },
    verify: {
      type: "string",
      description: "How many pages to re-measure with screenshots",
      default: "12",
    },
    concurrency: { type: "string", description: "Pages measured in parallel", default: "4" },
    build: { type: "boolean", description: "Build before measuring", default: true },
    "from-state": {
      type: "boolean",
      description: "Reuse the corrections already recorded instead of re-measuring",
      default: false,
    },
  },
  async run({ args }) {
    const targetRoot = path.resolve(args.target);
    const viewports = args.viewports.split(",").map(Number);
    const pages = args.pages
      ? args.pages
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : pagesFromIr();

    const build = (label) => {
      process.stdout.write(`${label} … `);
      const t = Date.now();
      execFileSync("npm", ["run", "build"], { cwd: targetRoot, stdio: "pipe" });
      console.log(`${((Date.now() - t) / 1000).toFixed(0)}s`);
    };

    const measure = async (slug, shots) => {
      try {
        return await runCompare({
          page: `${slug}.html`,
          static: args.static,
          dist: args.dist,
          target: args.target,
          viewports,
          shots,
          quiet: true,
        });
      } catch (e) {
        console.log(`  ! ${slug}: ${e.message.split("\n")[0]}`);
        return null;
      }
    };

    // Measuring a page drives a browser through two full renders at three
    // widths — the dominant cost, and entirely independent per page, so it runs
    // several at a time. Applying corrections does NOT: components are shared
    // between pages, and two workers rewriting the same file's correction
    // region would interleave. Measure in parallel, write serially.
    const concurrency = Math.max(1, Number(args.concurrency));
    const measureAll = async (shotsFor) => {
      const queue = [...pages];
      const results = new Map();
      let done = 0;
      const worker = async () => {
        for (;;) {
          const slug = queue.shift();
          if (!slug) return;
          const report = await measure(slug, shotsFor(slug));
          results.set(slug, report);
          done++;
          if (done % 10 === 0) console.log(`    … ${done}/${pages.length}`);
        }
      };
      await Promise.all(Array.from({ length: concurrency }, worker));
      return results;
    };

    if (args.build && !args["from-state"]) build("building");

    // ---- pass 1: measure everything, plan every page's corrections
    const before = new Map();
    const plans = new Map();
    if (args["from-state"]) {
      // Re-applying what previous runs already measured — used after changing
      // how corrections are reconciled, where re-measuring would produce the
      // same findings at the cost of another full pass.
      for (const slug of pages) {
        const state = loadState(path.join(HERE, ".wpmig/corrections", `${slug}.json`));
        if (state.size) plans.set(slug, state);
      }
      console.log(`reusing recorded corrections from ${plans.size} page(s)`);
    } else {
      console.log(`\nmeasuring ${pages.length} page(s), ${concurrency} at a time …`);
      const reports = await measureAll(() => false);
      for (const slug of pages) {
        const report = reports.get(slug);
        if (!report) continue;
        before.set(slug, report.summary.totalFindings);

        const { plan } = planCorrections(report, { baseViewport: Math.min(...viewports) });
        if (!plan.size) continue;
        const stateFile = path.join(HERE, ".wpmig/corrections", `${slug}.json`);
        const merged = mergePlan(loadState(stateFile), plan);
        saveState(stateFile, merged);
        plans.set(slug, merged);
        console.log(
          `  ${slug}: ${report.summary.totalFindings} findings → ${countDecls(merged)} correction(s)`
        );
      }
    }

    // A component's corrections live in one region inside that component, but
    // components are shared between pages — so applying page by page lets the
    // last page written decide what every other page using it renders. Its
    // corrections are silently replaced by a different page's measurements, and
    // the pages that were already right get worse.
    //
    // So the corrections are reconciled first and written once. A declaration
    // on a component that only one page uses is that page's to make. On a
    // shared component it has to be unanimous: every page using it measured the
    // same value. Anything else is a genuine disagreement about what the
    // component should be — reported, not guessed at, and the way to resolve it
    // is to stop sharing the component.
    const { global: globalPlan, dropped } = reconcilePlans(plans);
    const applied = applyCorrections(targetRoot, args.namespace, globalPlan);
    const decls = applied.reduce((a, x) => a + x.declarations, 0);
    console.log(
      `\napplied ${decls} correction(s) across ${applied.length} component(s)` +
        (dropped ? `; held back ${dropped} that pages sharing a component disagreed on` : "")
    );
    build("rebuilding");

    // ---- pass 2: verify. Screenshots only for a sample — they dominate the
    // runtime, and the finding counts already cover every page.
    const verifyCount = Number(args.verify);
    console.log(`\nre-measuring (${verifyCount} of them with screenshots) …`);
    const shotPages = new Set(pages.slice(0, verifyCount));
    const after = await measureAll((slug) => shotPages.has(slug));
    const rows = [];
    for (const slug of pages) {
      const report = after.get(slug);
      if (!report) continue;
      rows.push({
        slug,
        findings: report.summary.totalFindings,
        was: before.get(slug) ?? null,
        pixel: report.summary.meanPixel ?? null,
      });
    }

    rows.sort((a, b) => (b.pixel ?? 0) - (a.pixel ?? 0) || b.findings - a.findings);
    console.log(`\n════════ site fidelity ════════`);
    for (const r of rows) {
      const delta = r.was != null ? ` (was ${r.was})` : "";
      console.log(
        `${String(r.pixel ?? "—").padStart(6)}%  ${String(r.findings).padStart(4)} findings${delta.padEnd(12)}  ${r.slug}`
      );
    }
    const scored = rows.filter((r) => r.pixel != null);
    if (scored.length) {
      const mean = scored.reduce((a, r) => a + r.pixel, 0) / scored.length;
      console.log(
        `\nmean pixel mismatch across ${scored.length} sampled page(s): ${mean.toFixed(2)}%`
      );
    }
    console.log(`total findings: ${rows.reduce((a, r) => a + r.findings, 0)}`);

    const out = path.join(HERE, ".wpmig/compare/site-report.json");
    fs.writeFileSync(
      out,
      JSON.stringify({ generatedAt: new Date().toISOString(), pages: rows }, null, 2)
    );
    console.log(`\nreport: ${path.relative(process.cwd(), out)}`);
  },
});
