import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defineCommand } from "citty";
import { VIEWPORTS } from "../src/capture/screenshot.mjs";
import { runCompare } from "./compare.mjs";
import {
  planCorrections,
  applyCorrections,
  loadState,
  saveState,
  mergePlan,
} from "../src/refine/index.mjs";

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const devRefine = defineCommand({
  meta: {
    name: "dev-refine",
    description:
      "Iteratively correct the built page until it visually matches the WordPress original.",
  },
  args: {
    page: { type: "positional", description: "Source page file", required: true },
    route: { type: "string", description: "Built route (defaults to the slug)" },
    static: {
      type: "string",
      description: "Snapshot directory",
      default: path.join(HERE, "../site-migrator/static"),
    },
    dist: {
      type: "string",
      description: "Built Astro output",
      default: path.join(HERE, "../dist"),
    },
    target: { type: "string", description: "Target repo root", default: path.join(HERE, "..") },
    namespace: { type: "string", description: "Generated component namespace", default: "wpmig" },
    viewports: {
      type: "string",
      description: "Comma-separated widths",
      default: VIEWPORTS.join(","),
    },
    "max-iterations": { type: "string", description: "Correction passes", default: "3" },
    threshold: {
      type: "string",
      description: "Stop when mean pixel mismatch is under this %",
      default: "2",
    },
  },
  async run({ args }) {
    const targetRoot = path.resolve(args.target);
    const viewports = args.viewports.split(",").map(Number);
    const maxIterations = Number(args["max-iterations"]);
    const threshold = Number(args.threshold);

    const compareOpts = {
      page: args.page,
      route: args.route,
      static: args.static,
      dist: args.dist,
      target: args.target,
      viewports,
      shots: true,
      quiet: true,
    };

    const build = () => {
      process.stdout.write("    building … ");
      const t = Date.now();
      execFileSync("npm", ["run", "build"], { cwd: targetRoot, stdio: "pipe" });
      console.log(`${((Date.now() - t) / 1000).toFixed(0)}s`);
    };

    const slug = args.page.replace(/\.html?$/, "");
    const stateFile = path.join(HERE, ".wpmig/corrections", `${slug}.json`);
    let cumulative = loadState(stateFile);
    const history = [];
    console.log(
      `refining ${args.page} at ${viewports.join("/")}px (max ${maxIterations} passes)\n`
    );

    // Baseline: where does the generated page start?
    console.log("pass 0 — baseline");
    let report = await runCompare(compareOpts);
    let mean = report.summary.meanPixel;
    let findings = report.summary.totalFindings;
    console.log(`    mean pixel mismatch ${mean}%   findings ${findings}`);
    history.push({ pass: 0, mean, findings });

    for (let i = 1; i <= maxIterations; i++) {
      if (mean <= threshold) {
        console.log(`\nunder threshold (${threshold}%) — stopping`);
        break;
      }

      console.log(`\npass ${i}`);
      const { plan, skipped } = planCorrections(report, { baseViewport: Math.min(...viewports) });
      cumulative = mergePlan(cumulative, plan);
      saveState(stateFile, cumulative);
      const applied = applyCorrections(targetRoot, args.namespace, cumulative);
      const decls = applied.reduce((a, x) => a + x.declarations, 0);
      const fresh = [...plan.values()].reduce(
        (a, e) =>
          a +
          [...e.base.values()].reduce((b, m) => b + m.size, 0) +
          [...e.media.values()].reduce(
            (b, sm) => b + [...sm.values()].reduce((c, m) => c + m.size, 0),
            0
          ),
        0
      );
      console.log(
        `    corrections: +${fresh} new, ${decls} cumulative across ${applied.length} component(s)`
      );
      console.log(
        `    left alone:  ${skipped.length} finding(s) whose cause is structural or upstream`
      );

      if (!fresh) {
        console.log("    nothing mechanically correctable — stopping");
        break;
      }

      build();
      const next = await runCompare(compareOpts);
      const nextMean = next.summary.meanPixel;
      const nextFindings = next.summary.totalFindings;
      const delta = mean - nextMean;
      console.log(
        `    mean pixel mismatch ${nextMean}% (${delta >= 0 ? "-" : "+"}${Math.abs(delta).toFixed(2)})` +
          `   findings ${nextFindings} (${findings - nextFindings >= 0 ? "-" : "+"}${Math.abs(findings - nextFindings)})`
      );
      history.push({ pass: i, mean: nextMean, findings: nextFindings });

      // Regression guard: a correction pass that makes things worse is worse
      // than no pass. Report it rather than iterating deeper on a bad premise.
      if (nextMean > mean + 0.5) {
        console.log(
          "    ! this pass regressed the match — review the corrections region before continuing"
        );
        report = next;
        mean = nextMean;
        findings = nextFindings;
        break;
      }
      if (Math.abs(delta) < 0.25 && nextFindings >= findings) {
        console.log("    converged (no further mechanical improvement available)");
        report = next;
        mean = nextMean;
        findings = nextFindings;
        break;
      }

      report = next;
      mean = nextMean;
      findings = nextFindings;
    }

    const outDir = path.join(HERE, ".wpmig/compare", args.page.replace(/\.html?$/, ""));
    fs.writeFileSync(path.join(outDir, "refine-history.json"), JSON.stringify(history, null, 2));

    console.log("\n════════ refine summary ════════");
    for (const h of history) {
      console.log(
        `  pass ${h.pass}:  ${String(h.mean).padStart(6)}%   ${String(h.findings).padStart(4)} findings`
      );
    }
    console.log("\nworst remaining:");
    for (const w of report.summary.worst.slice(0, 8)) {
      console.log(
        `  ${String(w.pixel ?? "—").padStart(6)}%  ${String(w.findings).padStart(3)} findings   ${w.id} @${w.width}`
      );
    }
    console.log(`\nreport: ${path.relative(process.cwd(), path.join(outDir, "report.json"))}`);
  },
});
