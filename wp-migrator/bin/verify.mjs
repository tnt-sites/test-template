/**
 * `wpmig dev-verify` — compare every built page against its source snapshot by
 * pairing elements on their text, and report typography that disagrees.
 *
 * See `src/qa/pair-by-text.mjs` for why text is the key and the positional
 * `data-wpmig-n` index is not.
 */

import fs from "node:fs";
import path from "node:path";
import { defineCommand } from "citty";
import { chromium } from "playwright";
import { serve } from "../src/mirror/serve.mjs";
import { gotoStable } from "../src/browser/load.mjs";
import { loadRouteMap } from "../src/snapshot/routes.mjs";
import { READ_TEXT_NODES, diffTextNodes, severeFindings } from "../src/qa/pair-by-text.mjs";

export const devVerify = defineCommand({
  meta: {
    name: "dev-verify",
    description: "Compare built pages against the source snapshot, pairing elements by text.",
  },
  args: {
    static: { type: "string", description: "Snapshot directory", default: "" },
    dist: { type: "string", description: "Built site directory", default: "" },
    pages: { type: "string", description: "Comma-separated page slugs (default: all)", default: "" },
    ignore: { type: "string", description: "Style properties to skip", default: "color,backgroundColor" },
    "severe-only": { type: "boolean", description: "Only headings/body swapped by 6px or more", default: false },
    json: { type: "string", description: "Write full findings to this file", default: "" },
  },
  async run({ args }) {
    const here = path.dirname(new URL(import.meta.url).pathname);
    const staticDir = path.resolve(args.static || path.join(here, "../.wpmig/static"));
    const distDir = path.resolve(args.dist || path.join(here, "../../dist"));

    if (!fs.existsSync(staticDir)) throw new Error(`snapshot dir not found: ${staticDir}`);
    if (!fs.existsSync(distDir)) throw new Error(`dist not found: ${distDir} — run a build first`);

    const routes = loadRouteMap(staticDir);
    const wanted = args.pages ? new Set(args.pages.split(",").map((s) => s.trim())) : null;
    const ignore = args.ignore.split(",").map((s) => s.trim()).filter(Boolean);

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
      const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });

      for (const slug of slugs) {
        const route = routes.get(slug);
        const builtFile = path.join(distDir, route.replace(/^\//, ""), "index.html");

        if (!fs.existsSync(builtFile)) continue;

        const read = async (url) => {
          const state = await gotoStable(page, url, { primeLazyLoad: true, reveal: true });

          if (!state.ok) return null;
          return page.evaluate(READ_TEXT_NODES);
        };

        const sourceNodes = await read(`${src.url}/${slug}.html`);
        const builtNodes = await read(`${blt.url}${route}`);

        if (!sourceNodes || !builtNodes) {
          console.log(`  ${slug}: could not load, skipped`);
          continue;
        }

        let findings = diffTextNodes(sourceNodes, builtNodes, { ignore });

        if (args["severe-only"]) findings = severeFindings(findings);
        const severe = severeFindings(findings);

        if (findings.length) {
          report.push({ slug, route, findings });
          console.log(`${slug}  ${findings.length} mismatch(es)${severe.length ? `, ${severe.length} severe` : ""}`);
          for (const f of severe.slice(0, 6)) {
            const parts = f.diffs.map((d) => `${d.prop} ${d.source} -> ${d.built}`).join(", ");

            console.log(`    <${f.sourceTag}> "${f.key.slice(0, 52)}"  ${parts}`);
          }
        }
      }
    } finally {
      await browser.close();
      src.server.close();
      blt.server.close();
    }

    const totalSevere = report.reduce((n, r) => n + severeFindings(r.findings).length, 0);

    console.log(
      `\n${slugs.length} page(s) checked — ${report.length} with mismatches, ${totalSevere} severe.`
    );
    if (args.json) {
      fs.writeFileSync(path.resolve(args.json), JSON.stringify(report, null, 2));
      console.log(`full findings -> ${args.json}`);
    }
  },
});
