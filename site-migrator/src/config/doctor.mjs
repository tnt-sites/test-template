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

/**
 * Template-side traps that silently break a hand-built component.
 *
 * Each of these cost a round of "it doesn't look like the original" before
 * being found, so they are reported up front rather than discovered later.
 * See README, "Visual fidelity: what actually goes wrong".
 */
export function templateHazards(targetRoot) {
  const out = [];
  const stylesDir = path.join(targetRoot, "src/styles");

  const walk = (dir) => {
    let acc = "";
    if (!fs.existsSync(dir)) return acc;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) acc += walk(full);
      else if (/\.p?css$/.test(entry.name)) acc += fs.readFileSync(full, "utf8");
    }
    return acc;
  };
  const css = walk(stylesDir);
  if (!css) return out;

  // 1. Generic class names the template already claims. Astro scopes a
  //    component's styles, but global CSS still matches its elements.
  const generic =
    /^(panel|card|media|inner|copy|row|label|value|body|items|cards|logos|frame|play|name|more|details|intro|lead)$/;
  const claimed = [
    ...new Set(
      [...css.matchAll(/(?:^|[\s,}])\.([a-z][a-z0-9-]{2,})\s*(?:,|\{)/gm)]
        .map((m) => m[1])
        .filter((c) => generic.test(c))
    ),
  ];
  if (claimed.length) {
    out.push({
      level: "warn",
      label: "Class collisions",
      detail: `template styles .${claimed.slice(0, 6).join(", .")} — prefix your component classes`,
    });
  }

  // 2. A global list marker that needs an escape hatch.
  if (/\bli:{1,2}before\b/.test(css)) {
    out.push({
      level: "warn",
      label: "Global list marker",
      detail: `li:before injects a marker${/\.no-check\b/.test(css) ? " — use ul.no-check" : ""}`,
    });
  }

  // 3. Layer order: a bridge layer loses to unlayered component styles.
  if (/@layer[^;{]*source-bridge/.test(css)) {
    out.push({
      level: "info",
      label: "Layer order",
      detail: "source-bridge loses to component <style> blocks (unlayered) — style internals in the component",
    });
  }

  return out;
}
