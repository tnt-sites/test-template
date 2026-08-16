import fs from "node:fs";
import path from "node:path";

/**
 * Preflight checks.
 *
 * The pipeline's stages take minutes each and several only fail at the point
 * they try to write. Checking the obvious preconditions up front turns "it
 * crashed twenty minutes in" into a list of things to fix.
 */

const CHECKS = [
  {
    name: "Node version",
    run() {
      const major = Number(process.versions.node.split(".")[0]);
      return major >= 22
        ? { ok: true, detail: `v${process.versions.node}` }
        : { ok: false, detail: `v${process.versions.node} — needs 22 or newer` };
    },
  },
  {
    name: "Browser",
    async run() {
      try {
        const { chromium } = await import("playwright");
        const browser = await chromium.launch();
        const version = browser.version();
        await browser.close();
        return { ok: true, detail: version };
      } catch (e) {
        return {
          ok: false,
          detail: `cannot launch Chromium — run \`npx playwright install chromium\` (${e.message.split("\n")[0]})`,
        };
      }
    },
  },
  {
    name: "Source site",
    run(ctx) {
      const base = ctx.config.source.base;
      if (!base.startsWith("file:")) return { ok: true, detail: `remote: ${base}` };

      const dir = path.resolve(ctx.paths.configDir, base.slice("file:".length));
      if (!fs.existsSync(dir)) return { ok: false, detail: `${base} does not exist` };

      const pages = fs.readdirSync(dir).filter((f) => /\.html?$/i.test(f));
      return pages.length
        ? { ok: true, detail: `${pages.length} page(s) in ${base}` }
        : { ok: false, detail: `${base} contains no HTML pages` };
    },
  },
  {
    name: "Target repo",
    run(ctx) {
      const missing = [
        ["components", ctx.paths.components],
        ["content", ctx.paths.content],
        ["styles", ctx.paths.styles],
        ["data", ctx.paths.data],
      ].filter(([, dir]) => !fs.existsSync(dir));

      return missing.length === 0
        ? { ok: true, detail: path.relative(ctx.paths.configDir, ctx.paths.targetRoot) || "." }
        : {
            ok: false,
            detail: `missing ${missing.map(([n]) => n).join(", ")} — is target.root pointing at the site?`,
          };
    },
  },
  {
    name: "Component library",
    async run(ctx) {
      const { loadComponentCatalog } = await import("../sections/suggest.mjs");
      const catalog = loadComponentCatalog(ctx.paths.components);
      return catalog.length
        ? { ok: true, detail: `${catalog.length} page-section component(s)` }
        : {
            ok: false,
            detail: "no components found — mapping proposals will be empty",
          };
    },
  },
  {
    name: "Stylesheets",
    run(ctx) {
      const sheets = ctx.config.source.stylesheets;
      return sheets.length
        ? { ok: true, detail: `${sheets.length} declared` }
        : { ok: false, detail: "none declared — the theme layer will be empty" };
    },
  },
  {
    name: "Segmentation rules",
    run(ctx) {
      const rules = ctx.config.segmentation.rules;
      return rules.length
        ? { ok: true, detail: `${rules.length} rule(s)` }
        : { ok: false, detail: "none — run `mig detect` after `mig mirror`" };
    },
  },
  {
    name: "Working tree",
    run(ctx) {
      // Not a failure: the toolkit never destroys uncommitted work, but a clean
      // tree makes its changes reviewable as a diff.
      const git = path.join(ctx.paths.targetRoot, ".git");
      if (!fs.existsSync(git)) return { ok: true, warn: true, detail: "target is not a git repo" };
      return { ok: true, detail: "git repo — changes will show as a diff" };
    },
  },
];

export async function runDoctor(ctx) {
  const results = [];
  for (const check of CHECKS) {
    try {
      results.push({ name: check.name, ...(await check.run(ctx)) });
    } catch (e) {
      results.push({ name: check.name, ok: false, detail: e.message });
    }
  }
  return results;
}
