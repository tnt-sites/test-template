/**
 * `wpmig dev-refix` — recompute the refine loop's corrections, pairing source
 * and built elements by text instead of by positional index.
 *
 * The original `dev-refine` pass paired through `data-wpmig-n` (see
 * `src/qa/pair-by-text.mjs`), which shifts whenever the source and rebuilt DOMs
 * collapse a different number of wrappers. Where it shifted, every element past
 * that point was corrected to its neighbour's typography — headings flattened
 * to body copy, and the paragraph after them blown up to heading size. 55 pages
 * carry that damage.
 *
 * This recomputes the same corrections from the same source measurements, with
 * pairing that holds, and rewrites each component's `wpmig:corrections` region.
 * A class seen on several pages is only corrected when those pages agree; a
 * disagreement is reported, never averaged.
 */

import fs from "node:fs";
import path from "node:path";
import { defineCommand } from "citty";
import { chromium } from "playwright";
import { serve } from "../src/mirror/serve.mjs";
import { gotoStable } from "../src/browser/load.mjs";
import { loadRouteMap } from "../src/snapshot/routes.mjs";
import { READ_TEXT_NODES } from "../src/qa/pair-by-text.mjs";
import { REGION_BEGIN, REGION_END } from "../src/refine/index.mjs";

/** Typography only — colour and geometry are not this pass's business. */
const FIXABLE = {
  fontFamily: "font-family",
  fontSize: "font-size",
  fontWeight: "font-weight",
  lineHeight: "line-height",
  textAlign: "text-align",
};

/**
 * Only components the migrator wrote are this pass's to correct.
 *
 * The site's own design system — `building-blocks/`, `navigation/`, and the
 * shared partials written by hand — deliberately does not match WordPress.
 * Copying the old site's type onto `Button` or `MainNav` would "fix" a
 * difference that is the point.
 */
function isMigrated(source, file) {
  if (/\/(building-blocks|navigation)\//.test(file)) return false;
  return source.includes("by wp-migrator");
}

/** Index every component-scoped class to the .astro file that writes it. */
function indexClasses(root) {
  const owner = new Map();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".astro")) {
        const src = fs.readFileSync(full, "utf8");

        if (!isMigrated(src, full)) continue;

        for (const m of src.matchAll(/class="([^"{]+)"/g)) {
          for (const cls of m[1].trim().split(/\s+/)) {
            if (!owner.has(cls)) owner.set(cls, full);
          }
        }
      }
    }
  };
  walk(root);
  return owner;
}

/** Read the declarations already in a file's corrections region. */
function readRegion(source) {
  const start = source.indexOf(REGION_BEGIN);
  const end = source.indexOf(REGION_END);

  if (start === -1 || end === -1) return { before: source, region: "", after: "" };
  return {
    before: source.slice(0, start),
    region: source.slice(start + REGION_BEGIN.length, end),
    after: source.slice(end + REGION_END.length),
  };
}

/**
 * Drop the declarations this pass is re-deciding from the existing region,
 * leaving anything it does not own (media-query blocks, colour fixes) intact.
 */
function stripOwned(region, selectors) {
  let out = region;

  for (const sel of selectors) {
    const re = new RegExp(`\\n?[ \\t]*\\${sel} \\{[^}]*\\}\\n?`, "g");

    out = out.replace(re, "\n");
  }
  return out.replace(/\n{3,}/g, "\n\n");
}

/**
 * The `min-width` breakpoints at which a component already sets one of the
 * properties we are about to correct for a class.
 *
 * A base-level correction loses to `@media (min-width: 1440px) { .bf-heading {
 * font-size: 46px } }` — and 1440 is the width these measurements are taken at,
 * so the correction would be written, look right in the file, and change
 * nothing on screen. Where the generated CSS reaches into a breakpoint, the
 * correction has to reach in after it.
 */
function breakpointsSetting(source, cls, props) {
  const found = new Set();
  const re = /@media \(min-width: (\d+)px\) \{([\s\S]*?)\n  \}/g;
  let m;

  while ((m = re.exec(source))) {
    const width = Number(m[1]);
    const rule = new RegExp(`\\.${cls} \\{([^}]*)\\}`).exec(m[2]);

    if (!rule) continue;
    if (props.some((prop) => new RegExp(`(^|;|\\s)${prop}\\s*:`).test(rule[1]))) found.add(width);
  }
  return [...found].sort((a, b) => a - b);
}

export const devRefix = defineCommand({
  meta: {
    name: "dev-refix",
    description: "Recompute component style corrections using text-based source/built pairing.",
  },
  args: {
    static: { type: "string", description: "Snapshot directory", default: "" },
    dist: { type: "string", description: "Built site directory", default: "" },
    components: { type: "string", description: "Components root", default: "" },
    pages: {
      type: "string",
      description: "Comma-separated page slugs (default: all)",
      default: "",
    },
    "dry-run": { type: "boolean", description: "Report without writing", default: false },
  },
  async run({ args }) {
    const here = path.dirname(new URL(import.meta.url).pathname);
    const staticDir = path.resolve(args.static || path.join(here, "../.wpmig/static"));
    const distDir = path.resolve(args.dist || path.join(here, "../../dist"));
    const compRoot = path.resolve(args.components || path.join(here, "../../src/components"));

    for (const [label, dir] of [
      ["snapshot", staticDir],
      ["dist", distDir],
      ["components", compRoot],
    ]) {
      if (!fs.existsSync(dir)) throw new Error(`${label} dir not found: ${dir}`);
    }

    const owner = indexClasses(compRoot);
    const routes = loadRouteMap(staticDir);
    const wanted = args.pages ? new Set(args.pages.split(",").map((s) => s.trim())) : null;
    const slugs = fs
      .readdirSync(staticDir)
      .filter((f) => f.endsWith(".html"))
      .map((f) => f.replace(/\.html$/, ""))
      .filter((slug) => routes.has(slug))
      .filter((slug) => !wanted || wanted.has(slug))
      .sort();

    // class -> prop -> Map(value -> [pages that measured it])
    const observed = new Map();
    // "class\0prop" pairs the build actually renders differently somewhere.
    const needed = new Set();
    const src = await serve(staticDir, 0);
    const blt = await serve(distDir, 0);
    const browser = await chromium.launch();
    let pagesRead = 0;

    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });

      for (const slug of slugs) {
        const route = routes.get(slug);

        if (!fs.existsSync(path.join(distDir, route.replace(/^\//, ""), "index.html"))) continue;

        const read = async (url) => {
          const state = await gotoStable(page, url, { primeLazyLoad: true, reveal: true });

          return state.ok ? page.evaluate(READ_TEXT_NODES) : null;
        };
        const sourceNodes = await read(`${src.url}/${slug}.html`);
        const builtNodes = await read(`${blt.url}${route}`);

        if (!sourceNodes || !builtNodes) continue;
        pagesRead += 1;

        const sourceMap = new Map(sourceNodes);

        for (const [key, b] of builtNodes) {
          const s = sourceMap.get(key);

          if (!s) continue;

          // The class the component actually styles: the one this file owns.
          const cls = b.classes.find((c) => owner.has(c));

          if (!cls) continue;

          for (const [jsProp, cssProp] of Object.entries(FIXABLE)) {
            if (!s.style[jsProp]) continue;
            const value =
              jsProp === "fontFamily" ? `${s.style[jsProp]}, sans-serif` : s.style[jsProp];

            // Record what the source says on EVERY page carrying this class,
            // not only the pages where the build currently disagrees.
            //
            // Recording just the disagreements makes the reconciliation below
            // blind in exactly the case it exists to catch. `.cgt-heading` is
            // centre-aligned on one page and left on another; whichever page
            // happened to differ was the only one observed, so the values map
            // held a single entry, no conflict was reported, and its alignment
            // was written into the shared component. The next run then saw the
            // *other* page differ and wrote the opposite value — a correction
            // that flipped on every pass and was wrong on one page either way.
            if (!observed.has(cls)) observed.set(cls, new Map());
            const props = observed.get(cls);

            if (!props.has(cssProp)) props.set(cssProp, new Map());
            const values = props.get(cssProp);

            if (!values.has(value)) values.set(value, []);
            values.get(value).push(slug);

            // Only a property some page actually renders wrongly is worth
            // writing; the rest are recorded purely so a disagreement shows up.
            if (s.style[jsProp] !== b.style[jsProp]) needed.add(`${cls}\u0000${cssProp}`);
          }
        }
      }
    } finally {
      await browser.close();
      src.server.close();
      blt.server.close();
    }

    // Resolve: a class is corrected only where every page that saw it agrees.
    const byFile = new Map();
    const conflicts = [];

    for (const [cls, props] of observed) {
      const decls = new Map();

      for (const [prop, values] of props) {
        if (!needed.has(`${cls}\u0000${prop}`)) continue;
        if (values.size > 1) {
          conflicts.push({ cls, prop, values: [...values.keys()] });
          continue;
        }
        decls.set(prop, [...values.keys()][0]);
      }
      if (!decls.size) continue;
      const file = owner.get(cls);

      if (!byFile.has(file)) byFile.set(file, new Map());
      byFile.get(file).set(`.${cls}`, decls);
    }

    const disagreeing = new Set([...needed].map((k) => k.split("\u0000")[0]));

    console.log(
      `${pagesRead} page(s) measured — ${disagreeing.size} class(es) disagree with source.`
    );
    if (process.env.REFIX_DEBUG) {
      for (const [cls, props] of observed)
        console.log(`   DEBUG ${cls} owner=${owner.get(cls)} props=${[...props.keys()].join(",")}`);
      console.log(`   DEBUG byFile.size=${byFile.size}`);
    }
    if (conflicts.length) {
      console.log(
        `${conflicts.length} class/property pair(s) measured differently on different pages, left alone:`
      );
      for (const c of conflicts.slice(0, 10))
        console.log(`    .${c.cls} ${c.prop}: ${c.values.join(" | ")}`);
    }

    let written = 0;

    for (const [file, rules] of byFile) {
      const source = fs.readFileSync(file, "utf8");
      const { before, region, after } = readRegion(source);
      const kept = stripOwned(region, [...rules.keys()]);
      const declBlock = (decls, indent) =>
        [...decls.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${indent}  ${k}: ${v};`)
          .join("\n");

      const baseParts = [];
      const perWidth = new Map();

      for (const [sel, decls] of rules) {
        baseParts.push(`  ${sel} {\n${declBlock(decls, "  ")}\n  }`);
        for (const width of breakpointsSetting(source, sel.slice(1), [...decls.keys()])) {
          if (!perWidth.has(width)) perWidth.set(width, []);
          perWidth.get(width).push(`    ${sel} {\n${declBlock(decls, "    ")}\n    }`);
        }
      }
      const rendered = [
        ...baseParts,
        ...[...perWidth.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(
            ([width, parts]) => `  @media (min-width: ${width}px) {\n${parts.join("\n\n")}\n  }`
          ),
      ].join("\n");

      let next;

      if (region) {
        next = `${before}${REGION_BEGIN}${kept.replace(/\s*$/, "\n")}${rendered}\n${REGION_END}${after}`;
      } else {
        // No region yet — open one just before the component's closing </style>.
        const at = source.lastIndexOf("</style>");

        if (at === -1) continue;
        next = `${source.slice(0, at)}${REGION_BEGIN}\n${rendered}\n${REGION_END}\n${source.slice(at)}`;
      }

      console.log(`  ${path.relative(compRoot, file)}: ${rules.size} rule(s)`);
      if (!args["dry-run"]) fs.writeFileSync(file, next);
      written += 1;
    }
    console.log(`\n${written} component(s) ${args["dry-run"] ? "would be" : ""} updated.`);
  },
});
