import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineCommand } from "citty";
import { runSnapshot } from "../src/snapshot/index.mjs";

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const devSnapshot = defineCommand({
  meta: {
    name: "dev-snapshot",
    description: "Fetch a live WordPress site into a flat local mirror (sitemap/REST/link-crawl discovery).",
  },
  args: {
    url: { type: "positional", description: "Site origin, e.g. https://example.com", required: true },
    out: { type: "string", description: "Output directory", default: path.join(HERE, ".wpmig/static") },
    "alt-hosts": { type: "string", description: "Comma-separated staging/legacy hosts to normalize to origin", default: "" },
    "extra-paths": { type: "string", description: "Comma-separated paths to include beyond discovery", default: "" },
    limit: { type: "string", description: "Cap page count (smoke test)", default: "0" },
    refresh: { type: "boolean", description: "Re-fetch pages already on disk", default: false },
    concurrency: { type: "string", default: "3" },
    render: {
      type: "boolean",
      description: "Render each page with JavaScript before saving (use --no-render for the fast pre-JS fetch)",
      default: true,
    },
    "render-viewport": { type: "string", description: "Render width in px", default: "1440" },
    "render-settle": { type: "string", description: "Settle ms after JS waits", default: "1500" },
    "render-concurrency": { type: "string", description: "Page concurrency when rendering", default: "2" },
  },
  async run({ args }) {
    const origin = args.url.replace(/\/$/, "");
    const report = await runSnapshot({
      origin,
      out: path.resolve(args.out),
      altHosts: args["alt-hosts"].split(",").map((s) => s.trim()).filter(Boolean),
      extraPaths: args["extra-paths"].split(",").map((s) => s.trim()).filter(Boolean),
      limit: Number(args.limit),
      refresh: args.refresh,
      concurrency: Number(args.concurrency),
      render: args.render,
      renderViewport: Number(args["render-viewport"]),
      renderSettleMs: Number(args["render-settle"]),
      renderConcurrency: Number(args["render-concurrency"]),
      log: (msg) => console.log(msg),
    });
    console.log(`\nwrote ${report.pages.length} page(s) to ${path.resolve(args.out)}`);
    if (report.pageFailures.length) {
      console.log(`${report.pageFailures.length} page failure(s):`);
      for (const f of report.pageFailures.slice(0, 10)) console.log(`  ${f.reason}  ${f.path}`);
    }
    if (report.assetFailures.length) {
      console.log(`${report.assetFailures.length} asset failure(s) (first 10):`);
      for (const f of report.assetFailures.slice(0, 10)) console.log(`  ${f.reason}  ${f.ref}`);
    }
  },
});
