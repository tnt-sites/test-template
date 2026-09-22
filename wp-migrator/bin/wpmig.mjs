#!/usr/bin/env node
/**
 * wp-migrator CLI.
 *
 * M1 surface: `dev-generate` — capture one hand-picked section from a rendered
 * snapshot and generate a CloudCannon Astro component from it. The full
 * pipeline commands (snapshot/extract/scan/review/generate/qa) build on the
 * same modules and land in later milestones.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineCommand, runMain } from "citty";
import { chromium } from "playwright";
import { serve } from "../src/mirror/serve.mjs";
import { gotoStable } from "../src/browser/load.mjs";
import { captureSection } from "../src/capture/section.mjs";
import { detectRepeats } from "../src/detect/repeats.mjs";
import { autoSegment, sectionSelector } from "../src/detect/segment.mjs";
import { extractProps, rewriteHtmlLinks, useRouteMap } from "../src/generate/props.mjs";
import { emitCss } from "../src/generate/css-emit.mjs";
import { emitAstro } from "../src/generate/astro-emit.mjs";
import { emitInputs, emitStructureValue, emitSnippets, emitBlock, blockValue, emitPage } from "../src/generate/cc-emit.mjs";
import { assertRoundTrips, isValidName, nameFromContent, nameFromShape } from "../src/generate/names.mjs";
import { structureHash, structureTokens, similarity } from "../src/generate/structure-hash.mjs";
import { findSharedPartials, ownedClasses } from "../src/generate/partials.mjs";
import { asContentRun } from "../src/generate/content-run.mjs";
import { accordionBlock, pullUpHeading, splitByAccordions, splitByAnchors } from "../src/generate/accordion.mjs";
import { expandDisclosures } from "../src/browser/disclose.mjs";
import { patchStarterComponents } from "../src/generate/starter-patch.mjs";
import { loadIconSet, resolveTreeIcons } from "../src/generate/icon-map.mjs";
import { loadBranding } from "../src/generate/color-palette.mjs";
import { collectAssetRefs, copyReferencedAssets } from "../src/generate/assets.mjs";
import { loadRouteMap } from "../src/snapshot/routes.mjs";
import { loadState, applyCorrections } from "../src/refine/index.mjs";
import { devExtract } from "./extract.mjs";
import { devSnapshot } from "./snapshot.mjs";
import { devVisualCheck } from "./visual-check.mjs";
import { devCompare } from "./compare.mjs";
import { devRefine } from "./refine.mjs";
import { devPosts } from "./posts.mjs";
import { devVerify } from "./verify.mjs";
import { devRefix } from "./refix.mjs";
import { devAudit } from "./audit.mjs";
import { devTriage } from "./triage.mjs";
import { devRefineAll } from "./refine-all.mjs";
import { devRelink } from "./relink.mjs";
import { devChrome } from "./chrome.mjs";

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Neutralize full-viewport fixed overlays (popups, cookie walls) before capture. */
async function suppressOverlays(page) {
  await page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      if (cs.position !== "fixed") continue;
      const r = el.getBoundingClientRect();
      if (r.width * r.height > vw * vh * 0.4) el.style.display = "none";
    }
  });
}

/**
 * Cross-page component registry, keyed by structure rather than by name.
 *
 * Component names are derived from a section's own content, and across a whole
 * site the same heading recurs constantly ("Schedule an Appointment" ends up on
 * forty pages). Within one page a collision gets a letter suffix; across pages
 * nothing stopped the second page from overwriting the first page's component
 * with its own markup — the first page then renders someone else's section,
 * silently, and only a visual comparison would ever catch it.
 *
 * Keying on the *name* was the deeper bug: the same page banner is called
 * `aetna-dental` on one page and `delta-dental` on the next, so two identical
 * components never got compared at all and the site ended up with 226
 * components for 292 sections — 48 of them the same banner. Identity now comes
 * from `structureHash` (markup + CSS with class names canonicalized), so
 * reuse is decided on shape and the name is only a label.
 *
 * v1 registries were name-keyed; they are dev-local state under .wpmig/ and are
 * discarded rather than migrated.
 */
const REGISTRY_VERSION = 2;

/**
 * Class prefixes handed out this run, so two components cannot claim the same
 * one. See `initialsOf` for what went wrong when they could.
 */
const TAKEN_PREFIXES = new Set();

function loadRegistry() {
  const file = path.join(HERE, ".wpmig/components.json");
  const empty = { file, version: REGISTRY_VERSION, components: {}, names: {} };
  if (!fs.existsSync(file)) return empty;
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  if (raw.version !== REGISTRY_VERSION) {
    console.log("registry: discarding v1 (name-keyed) state — components will be re-registered by structure");
    return empty;
  }
  return { file, ...raw };
}

function saveRegistry(registry) {
  const { file, ...state } = registry;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
}

/**
 * Find an already-registered component this section can render as.
 *
 * An exact structure hash is an unconditional share. Short of that, a
 * near-duplicate is only safe when the prop signatures are *identical*: the
 * clusters that differ by a few lines are almost always the same widget with a
 * `<p>` where another page had a `<div>`, or a min-height read 24px apart —
 * but where the props themselves differ, the same name can mean a different
 * role (the banner whose `heading` is an `<h1>` on 43 pages and an `<h3>`
 * eyebrow on 5), and silently pointing one at the other would demote real
 * headings. Those unions are curated, not inferred.
 */
function findReusable(registry, { hash, signature, tokens, threshold }) {
  const exact = registry.components[hash];
  if (exact) return { entry: exact, why: "identical" };

  let best = null;
  for (const entry of Object.values(registry.components)) {
    if (entry.signature !== signature || !entry.tokens) continue;
    const ceiling = (2 * Math.min(entry.tokens.length, tokens.length)) / (entry.tokens.length + tokens.length);
    if (ceiling < threshold) continue;
    const score = similarity(entry.tokens, tokens);
    if (score >= threshold && (!best || score > best.score)) best = { entry, score, why: `~${score.toFixed(2)}` };
  }
  return best;
}

/** Neutral name for the throwaway probe emit used to measure a section's shape. */
const PROBE_NAME = "probe";

/**
 * Letter suffixes only — a digit does not survive renderBlock's round trip.
 *
 * This is the last resort, not the first. A set named `page-banner`,
 * `page-banner-b`, `-c`, `-d` tells a template author nothing about which one
 * to reach for, and the toothbar migration produced exactly that: five copies
 * of one banner, distinguishable only by opening each file. Prefer
 * `qualifiedName` below, which spends the section's own words on the problem.
 */
function nextName(kebab) {
  const m = kebab.match(/^(.*?)-([a-z])$/);
  if (!m) return `${kebab}-b`;
  const next = String.fromCharCode(m[2].charCodeAt(0) + 1);
  return next > "z" ? `${kebab}-b` : `${m[1]}-${next}`;
}

/**
 * Distinguish a colliding shape-name by what the section actually says.
 *
 * When two genuinely different structures both classify as `prose-block`, the
 * useful distinction is in their content — `prose-block` and
 * `prose-block-reviews` beat `prose-block` and `prose-block-b`, because the
 * second pair requires opening both files to tell apart. Returns null when the
 * content yields nothing that isn't already in the name, and the caller falls
 * back to a letter.
 */
function qualifiedName(shapeName, tree, isFree) {
  const words = nameFromContent(tree, "");
  if (!words) return null;

  const have = new Set(shapeName.split("-"));
  // One or two content words is a label; more is a sentence fragment.
  for (const take of [1, 2]) {
    const qualifier = words
      .split("-")
      .filter((w) => !have.has(w))
      .slice(0, take)
      .join("-");
    if (!qualifier) continue;
    const candidate = `${shapeName}-${qualifier}`;
    if (isValidName(candidate) && isFree(candidate)) return candidate;
  }
  return null;
}

const devGenerate = defineCommand({
  meta: {
    name: "dev-generate",
    description: "Capture one section from a snapshot page and generate a component from it.",
  },
  args: {
    page: { type: "positional", description: "Page file in the snapshot dir (e.g. index.html)", required: true },
    pick: { type: "string", description: "CSS selector for the section root", required: true },
    name: { type: "string", description: "Component name (kebab-case)", required: true },
    static: { type: "string", description: "Snapshot directory", default: path.join(HERE, "../site-migrator/static") },
    target: { type: "string", description: "Target repo root", default: path.join(HERE, "..") },
    namespace: { type: "string", description: "Namespace under page-sections/", default: "wpmig" },
    breakpoints: { type: "string", description: "Comma-separated capture widths", default: "390,768,1440" },
    "dry-run": { type: "boolean", description: "Print instead of writing", default: false },
  },
  async run({ args }) {
    const { kebab } = assertRoundTrips(args.name);
    const breakpoints = args.breakpoints.split(",").map(Number).sort((a, b) => b - a);
    const staticDir = path.resolve(args.static);
    useRouteMap(loadRouteMap(staticDir));
    const targetRoot = path.resolve(args.target);
    if (!fs.existsSync(staticDir)) throw new Error(`snapshot dir not found: ${staticDir}`);

    const { server, url } = await serve(staticDir, 0);
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: breakpoints[0], height: 940 } });
      const pageUrl = `${url}/${args.page}`;
      const state = await gotoStable(page, pageUrl, { primeLazyLoad: true, reveal: true });
      if (!state.ok) throw new Error(`could not load ${pageUrl}: ${state.reason}`);
      await suppressOverlays(page);
      // Same reason as dev-page: segmentation and capture both have to see
      // the open state (see src/browser/disclose.mjs).
      await expandDisclosures(page);

      console.log(`capturing ${args.pick} on ${args.page} at ${breakpoints.join("/")}px …`);
      const captured = await captureSection(page, args.pick, { breakpoints });
      const repeats = detectRepeats(captured.tree);
      if (repeats.length) {
        console.log(`repeats: ${repeats.map((r) => `${r.tag}×${r.repeat.itemCount} (${r.repeat.confidence})`).join(", ")}`);
      }

      const extraction = extractProps({ ...captured, name: kebab, branding: loadBranding(targetRoot), takenPrefixes: TAKEN_PREFIXES });
      const css = emitCss({ ...captured, ...extraction, origin: url });
      const astro = emitAstro({
        name: kebab,
        tree: captured.tree,
        props: extraction.props,
        values: extraction.values,
        colorSlots: extraction.colorSlots,
        backgroundImageProp: extraction.backgroundImageProp,
        css,
        source: `${args.page.replace(/\.html?$/, "")} (${args.pick})`,
      });

      const ccArgs = { name: kebab, namespace: args.namespace, props: extraction.props, values: extraction.values, backgroundImageProp: extraction.backgroundImageProp, flags: [] };
      const files = {
        [`${pascalFile(kebab)}.astro`]: astro,
        [`${kebab}.cloudcannon.inputs.yml`]: emitInputs(ccArgs),
        [`${kebab}.cloudcannon.structure-value.yml`]: emitStructureValue(ccArgs),
        [`${kebab}.cloudcannon.snippets.yml`]: emitSnippets(ccArgs),
      };

      const outDir = path.join(targetRoot, "src/components/page-sections", args.namespace, kebab);
      const blockYaml = emitBlock(ccArgs);
      const blockPath = path.join(HERE, ".wpmig/out", `${kebab}.block.yml`);

      if (args["dry-run"]) {
        for (const [file, content] of Object.entries(files)) {
          console.log(`\n===== ${file} =====\n${content}`);
        }
        console.log(`\n===== pageSections block =====\n${blockYaml}`);
      } else {
        fs.mkdirSync(outDir, { recursive: true });
        for (const [file, content] of Object.entries(files)) {
          fs.writeFileSync(path.join(outDir, file), content);
        }
        fs.mkdirSync(path.dirname(blockPath), { recursive: true });
        fs.writeFileSync(blockPath, blockYaml);
        console.log(`\nwrote ${Object.keys(files).length} files to ${path.relative(process.cwd(), outDir)}`);
        console.log(`occurrence block: ${path.relative(process.cwd(), blockPath)}`);
      }

      const propSummary = extraction.props.map((p) => (p.kind === "array" ? `${p.name}[${p.itemProps.map((i) => i.name).join(",")}]` : `${p.name}:${p.kind}`));
      console.log(`props: ${propSummary.join("  ")}`);
    } finally {
      await browser.close();
      server.close();
    }
  },
});

/** Opacity of a computed colour; `rgba(0, 0, 0, 0)` is how a style spells transparent. */
function alphaOf(color) {
  const m = String(color || "").match(/rgba?\(([^)]+)\)/);
  if (!m) return color && color !== "transparent" ? 1 : 0;
  const parts = m[1].split(",").map(parseFloat);
  return parts.length > 3 ? parts[3] : 1;
}

function pascalFile(kebab) {
  return kebab
    .split("-")
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join("");
}

/** Turn one captured section into a component's 4 files + its page block. */
function generateComponent({ captured, kebab, namespace, source, iconSet = [], branding = {} }) {
  const iconReport = resolveTreeIcons(captured.tree, iconSet);
  const extraction = extractProps({ ...captured, name: kebab, branding, takenPrefixes: TAKEN_PREFIXES });
  const css = emitCss({ ...captured, ...extraction, origin: source.origin });
  const astro = emitAstro({
    name: kebab,
    tree: captured.tree,
    props: extraction.props,
    values: extraction.values,
    colorSlots: extraction.colorSlots,
    backgroundImageProp: extraction.backgroundImageProp,
    css,
    source: source.label,
  });

  const ccArgs = {
    name: kebab,
    namespace,
    props: extraction.props,
    values: extraction.values,
    backgroundImageProp: extraction.backgroundImageProp,
    flags: [],
  };
  const files = {
    [`${pascalFile(kebab)}.astro`]: astro,
    [`${kebab}.cloudcannon.inputs.yml`]: emitInputs(ccArgs),
    [`${kebab}.cloudcannon.structure-value.yml`]: emitStructureValue(ccArgs),
    [`${kebab}.cloudcannon.snippets.yml`]: emitSnippets(ccArgs),
  };
  const block = blockValue(ccArgs);
  // The pairing key for visual validation: which captured source node (`n`,
  // addressable via the capture marker) became which generated class name.
  // Without this the two renders share no common element identity.
  const nodeMap = [];
  (function walk(node) {
    if (!node || node.skip) return;
    if (node.cls != null && node.n != null) nodeMap.push({ n: node.n, cls: node.cls });
    // An array renders ONE template item in the markup and maps over the data,
    // so every item shares one set of class names. Mapping the sibling items
    // too would ask the comparison to find `.x-media7` in the built page,
    // which by design does not exist — reported as 100 phantom "missing"
    // elements. Only the template is addressable.
    if (node.array?.template) return walk(node.array.template);
    for (const c of node.children || []) walk(c);
  })(captured.tree);
  const propSummary = extraction.props.map((p) =>
    p.kind === "array" ? `${p.name}[${p.itemProps.map((i) => i.name).join(",")}]` : `${p.name}:${p.kind}`
  );
  return { files, block, propSummary, nodeMap, iconReport, repeats: captured.tree.array ? 1 : 0 };
}

const devScan = defineCommand({
  meta: {
    name: "dev-scan",
    description: "Auto-detect a page's content sections from rendered geometry (builder-agnostic).",
  },
  args: {
    page: { type: "positional", description: "Page file in the snapshot dir (e.g. index.html)", required: true },
    static: { type: "string", description: "Snapshot directory", default: path.join(HERE, "../site-migrator/static") },
    "fold-below": { type: "string", description: "Fold candidates shorter than this (px) into the previous section", default: "40" },
    "no-split-sidebars": {
      type: "boolean",
      description: "Keep a [sidebar, content] row as one section instead of splitting the rail off.",
      default: false,
    },
  },
  async run({ args }) {
    const staticDir = path.resolve(args.static);
    useRouteMap(loadRouteMap(staticDir));
    if (!fs.existsSync(staticDir)) throw new Error(`snapshot dir not found: ${staticDir}`);

    const { server, url } = await serve(staticDir, 0);
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 940 } });
      const pageUrl = `${url}/${args.page}`;
      const state = await gotoStable(page, pageUrl, { primeLazyLoad: true, reveal: true });
      if (!state.ok) throw new Error(`could not load ${pageUrl}: ${state.reason}`);
      await suppressOverlays(page);
      // Same reason as dev-page: segmentation and capture both have to see
      // the open state (see src/browser/disclose.mjs).
      await expandDisclosures(page);

      const sections = await autoSegment(page, {
        foldBelowPx: Number(args["fold-below"]),
        splitSidebars: !args["no-split-sidebars"],
      });
      console.log(`${sections.length} content section(s) detected on ${args.page}:\n`);
      for (const s of sections) {
        const foldNote = s.folded ? `  (+${s.folded} folded)` : "";
        console.log(
          `[${s.n}] <${s.tag}>  h=${s.box.h}px  img=${s.hasImagery ? "y" : "n"}  h1/h2=${s.hasHeading ? "y" : "n"}${foldNote}`
        );
        console.log(`    "${s.textPreview}"`);
        console.log(`    selector: ${sectionSelector(s.n)}`);
        if (s.review) console.log(`    ⚠ review: ${s.review}`);
      }
    } finally {
      await browser.close();
      server.close();
    }
  },
});

const devPage = defineCommand({
  meta: {
    name: "dev-page",
    description: "Auto-segment a page and generate a component for every detected section.",
  },
  args: {
    page: { type: "positional", description: "Page file in the snapshot dir (e.g. index.html)", required: true },
    slug: { type: "string", description: "Output page slug (defaults to the source filename)" },
    static: { type: "string", description: "Snapshot directory", default: path.join(HERE, "../site-migrator/static") },
    target: { type: "string", description: "Target repo root", default: path.join(HERE, "..") },
    namespace: { type: "string", description: "Namespace under page-sections/", default: "wpmig" },
    "reuse-threshold": {
      type: "string",
      description: "Structural similarity (0-1) at which a section reuses an existing component. 1 = identical only.",
      default: "0.85",
    },
    breakpoints: { type: "string", description: "Comma-separated capture widths", default: "390,768,1440" },
    "fold-below": { type: "string", description: "Fold candidates shorter than this (px) into the previous section", default: "40" },
    "no-split-sidebars": {
      type: "boolean",
      description: "Keep a [sidebar, content] row as one section instead of splitting the rail off.",
      default: false,
    },
    "content-section": {
      type: "string",
      description:
        "Component ref that renders a `blocks` array. Sections that are only a run of headings/prose/photos are emitted as data on it instead of forking a component per length. Empty to disable.",
      default: "page-sections/shared-blocks/content-section",
    },
    "accordion-section": {
      type: "string",
      description:
        "Component ref that renders an accordion from an `items` array. Accordion widgets are routed to it with their panels and measured design instead of being flattened into a static stack. Empty to disable.",
      default: "page-sections/info-blocks/faq-section",
    },
    "dry-run": { type: "boolean", description: "Print a summary instead of writing", default: false },
  },
  async run({ args }) {
    const breakpoints = args.breakpoints.split(",").map(Number).sort((a, b) => b - a);
    const staticDir = path.resolve(args.static);
    const routes = loadRouteMap(staticDir);
    useRouteMap(routes);
    const registry = loadRegistry();
    const reuseThreshold = Number(args["reuse-threshold"]);
    if (!(reuseThreshold > 0 && reuseThreshold <= 1)) {
      throw new Error(`--reuse-threshold must be in (0,1]: ${args["reuse-threshold"]}`);
    }
    const targetRoot = path.resolve(args.target);
    if (!fs.existsSync(staticDir)) throw new Error(`snapshot dir not found: ${staticDir}`);
    // Two identities, and conflating them is what flattens a site's URLs. The
    // snapshot filename addresses the capture (and keys the IR, so compare and
    // refine can find it again); the source URL decides where the page lands in
    // the target and what it is canonical at.
    const fileSlug = args.page.replace(/\.html?$/, "");
    const route = routes.get(fileSlug) || (fileSlug === "index" ? "/" : `/${fileSlug}/`);
    const slug = args.slug ?? route.replace(/^\/|\/$/g, "");

    const { server, url } = await serve(staticDir, 0);
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: breakpoints[0], height: 940 } });
      const pageUrl = `${url}/${args.page}`;
      const state = await gotoStable(page, pageUrl, { primeLazyLoad: true, reveal: true });
      if (!state.ok) throw new Error(`could not load ${pageUrl}: ${state.reason}`);
      await suppressOverlays(page);
      // Before segmentation: an open accordion is several times taller than a
      // closed one, and a closed panel's content is invisible to the capture
      // entirely. This measures each widget's closed *and* open design on the
      // way past, since afterwards the closed state is gone.
      const disclosed = await expandDisclosures(page);
      if (disclosed.accordions) {
        console.log(`opened ${disclosed.opened} disclosure(s); ${disclosed.accordions} accordion(s), ${disclosed.panels} panels`);
      }

      const sections = await autoSegment(page, {
        foldBelowPx: Number(args["fold-below"]),
        splitSidebars: !args["no-split-sidebars"],
      });
      console.log(`${sections.length} section(s) detected on ${args.page}`);

      // The ids the page's own navigation jumps to are section boundaries the
      // segmenter's geometry cannot see — a builder can nest two of them in one
      // container. Collect them once so each captured section can be split at
      // any it holds inside (see `splitByAnchors`).
      const anchorIds = await page.evaluate(() => {
        const ids = new Set();
        for (const a of document.querySelectorAll('a[href*="#"]')) {
          const m = (a.getAttribute("href") || "").match(/#([\w-]+)$/);
          if (m && document.getElementById(m[1])) ids.add(m[1]);
        }
        return [...ids];
      });

      const used = new Set();
      // Only route content runs at a component the target actually has;
      // otherwise the page would reference something that renders nothing.
      const contentSectionRef =
        args["content-section"] &&
        fs.existsSync(path.join(targetRoot, "src/components", args["content-section"]))
          ? args["content-section"]
          : "";

      if (args["content-section"] && !contentSectionRef) {
        console.log(`  note: ${args["content-section"]} not found in target — content runs will fork components as before`);
      }
      const accordionRef =
        args["accordion-section"] &&
        fs.existsSync(path.join(targetRoot, "src/components", args["accordion-section"]))
          ? args["accordion-section"]
          : "";

      if (args["accordion-section"] && !accordionRef) {
        console.log(`  note: ${args["accordion-section"]} not found in target — accordions will fork components as before`);
      }
      const iconSet = loadIconSet(targetRoot);
      const branding = loadBranding(targetRoot);
      const ir = { page: slug, route, source: args.page, breakpoints, sections: [] };
      /**
       * What the generator was unsure about, kept as a sibling of the IR.
       *
       * These signals are computed anyway on the way to a decision, and until
       * now were printed and dropped. Persisting them lets `dev-triage` rank a
       * page it has no other reason to suspect — a section whose repeat
       * boundaries were guessed renders perfectly well and is still wrong.
       *
       * It is a separate file rather than a field on the IR because the two
       * degrade differently: `dev-compare` hard-fails without an IR, whereas an
       * absent uncertainty record must read as "nothing to say" and cost the
       * page nothing. Pages generated before this existed have no record and
       * must not be penalised for it.
       */
      const uncertainty = {
        page: slug,
        route,
        generatedAt: "",
        sections: [],
        pageLevel: { missingAssets: [], skippedSections: [] },
      };
      const iconTally = { resolved: 0, unresolved: new Set() };
      const skippedSections = [];
      /** Sections whose accordion was lifted out — see the review note below. */
      const accordionSections = new Set();
      const blocks = [];
      const allFiles = {};
      let title = await page.title();
      title = title.split(/[|–—-]/)[0].trim() || slug;

      /**
       * Route one captured tree onto a component and push its block.
       *
       * This is the whole per-section decision — carousel, content run,
       * bespoke component — lifted out of the loop so it can be called more
       * than once for one section. An accordion section is rarely *only* an
       * accordion: the video widget on this site's New Patients page shares
       * its section with the Patient Forms block above it, so such a section
       * splits into the ordinary runs around its accordions and each run comes
       * back through here. With no accordion present this is called once and
       * the behaviour is exactly what it was.
       */
      const routeTree = (tree, { sectionIndex, captured, carousel = false, review = "" }) => {
        const repeats = detectRepeats(tree);

        // A rotating carousel cannot be reconstructed from computed styles —
        // its behaviour is JS. The target already ships a rotating strip
        // (`artisan/logo-strip`, with perView/autoplaySeconds), so a carousel
        // section is routed to it with the harvested slides and measured
        // colours rather than emitted as a bespoke static component that shows
        // every slide at once. Same trade as buttons: reuse where the target
        // already implements the behaviour, bespoke everywhere else.
        if (carousel) {
          const rep = repeats[repeats.length - 1];
          const slides = [];
          const walkImgs = (node) => {
            if (node.kind === "img" && node.attrs?.src) {
              slides.push({ image: node.attrs.src, alt: node.attrs.alt || "", link: "" });
            }
            for (const c of node.children || []) walkImgs(c);
          };
          if (rep) for (const item of rep.children || []) walkImgs(item);
          else walkImgs(tree);

          const seen = new Set();
          const logos = slides.filter((l) => !seen.has(l.image) && seen.add(l.image));

          // A rotating strip is image-dominant: slides and little else. A
          // bespoke section that happens to contain a slider still has its own
          // prose, and rerouting it would throw that content away entirely —
          // which is what happened to the "Meet Dr Andersen" section.
          let textLen = 0;
          (function measureText(node) {
            if (node.text) textLen += node.text.length;
            for (const c of node.children || []) measureText(c);
          })(tree);

          if (logos.length >= 3 && textLen < 200) {
            const bp0 = breakpoints[0];
            const rootRec = captured.styles[bp0]?.[tree.n];
            const rootStyles = rootRec?.styles ?? {};

            // Measure how the source presents this strip. A photo gallery runs
            // edge to edge with its images butted together; an award band is
            // centred with generous spacing. Same rotation, different
            // presentation — so read it rather than assume one of them.
            const slideBoxes = [];
            (function collectBoxes(node) {
              if (node.kind === "img") {
                const r = captured.styles[bp0]?.[node.n];
                if (r?.box?.w > 0) slideBoxes.push(r.box);
              }
              for (const c of node.children || []) collectBoxes(c);
            })(tree);
            slideBoxes.sort((a, b) => a.x - b.x);

            let gapPx = null;
            for (let i = 1; i < slideBoxes.length; i++) {
              const g = slideBoxes[i].x - (slideBoxes[i - 1].x + slideBoxes[i - 1].w);
              if (g >= 0 && g < 200) { gapPx = gapPx == null ? g : Math.min(gapPx, g); }
            }
            const fullBleed = (rootRec?.box?.w ?? 0) >= bp0 * 0.98;
            const slideH = slideBoxes.length ? Math.round(slideBoxes[0].h) : null;

            // Vertical breathing room, derived rather than read off the
            // section's own `padding-top`. Builders express this spacing in
            // several places — padding on the section, margin on an inner
            // wrapper, a spacer widget — so reading one property reports 0 for
            // a band that visibly has room around its logos. The space between
            // the section box and its slides is the same value however it was
            // authored: a flush gallery yields ~0, a logo band yields its real
            // padding.
            const sectionH = rootRec?.box?.h ?? 0;
            const derivedPad = slideH && sectionH > slideH
              ? Math.min(120, Math.round((sectionH - slideH) / 2))
              : 0;
            const bgImage = (rootStyles.backgroundImage || "").match(/url\(["']?([^"')]+)["']?\)/);
            const perView = Math.max(2, Math.min(6, Math.round((tree.box?.w || 1100) / 240)));
            blocks.push({
              _component: "page-sections/artisan/logo-strip",
              id: "",
              eyebrow: "",
              heading: "",
              logos,
              perView,
              autoplaySeconds: 5,
              backgroundColor: rootStyles.backgroundColor && !/rgba\(0, 0, 0, 0\)/.test(rootStyles.backgroundColor)
                ? rootStyles.backgroundColor : "transparent",
              backgroundImage: bgImage ? bgImage[1].replace(/^https?:\/\/[^/]+/, "") : "",
              overlayOpacity: 0.15,
              eyebrowColor: "#ffffff",
              headingColor: "#ffffff",
              gap: gapPx == null ? "1.5rem" : `${Math.round(gapPx / 2)}px`,
              maxWidth: fullBleed ? "none" : "1200px",
              paddingBlock: `${Math.max(Math.round(parseFloat(rootStyles.paddingTop) || 0), derivedPad)}px`,
              itemFit: fullBleed ? "cover" : "contain",
              itemHeight: slideH ? `${slideH}px` : "120px",
            });
            console.log(`  [${sectionIndex}] -> artisan/logo-strip (rotating, ${logos.length} slides, perView ${perView})`);
            return;
          }
        }
        // A section that is only a run of headings, prose, photos and buttons
        // carries no design of its own, and its *length* is not structure. Emit
        // it as data on the shared parametric component rather than as another
        // component whose prop list happens to have this many slots — see
        // `src/generate/content-run.mjs` for why that is the difference between
        // one component and forty.
        if (contentSectionRef) {
          const bpFirst = breakpoints[breakpoints.length - 1];
          const run = asContentRun(tree, {
            record: captured.styles?.[bpFirst]?.[tree.n],
            styles: captured.styles?.[bpFirst],
            hasRepeats: repeats.length > 0,
          });

          if (run) {
            blocks.push({
              _component: contentSectionRef,
              id: "",
              align: run.align,
              ...(run.design ? { design: run.design } : {}),
              blocks: run.blocks,
            });
            console.log(
              `  [${sectionIndex}] -> ${contentSectionRef} (content run, ${run.blocks.length} blocks)`
            );
            return;
          }
        }

        // detectRepeats returns innermost-first; the outermost (last) entry is
        // the one that survives generateComponent's nested-repeat pruning —
        // read the summary now, before that mutation happens.
        const repeatNote = repeats.length
          ? `  repeat=${repeats[repeats.length - 1].repeat.itemCount}x(${repeats[repeats.length - 1].repeat.confidence})`
          : "";

        const generate = (name) =>
          generateComponent({
            captured: structuredClone({ ...captured, tree }),
            kebab: name,
            namespace: args.namespace,
            source: { origin: url, label: `${slug} [${sectionIndex}] (auto)` },
            iconSet,
            branding,
          });

        // Probe under a neutral name first: the name is baked into the
        // component's class names, and both the structural hash and the shape
        // classification want to be read off a real emit rather than guessed
        // from the captured tree.
        const probe = generate(PROBE_NAME);
        const signature = probe.propSummary.join("|");
        const astroSource = probe.files[`${pascalFile(PROBE_NAME)}.astro`];
        const hash = structureHash(astroSource);
        const tokens = structureTokens(astroSource);

        // Name by what the section *is*, falling back to its words only when
        // the shape isn't one of the recognised families. Reuse is decided on
        // structure, so this is a label — but "page-banner" survives being
        // shared across 48 pages in a way that "aetna-dental" never could.
        const probeName =
          nameFromShape(tree, {
            // propSummary entries are "name:kind", not bare names.
            hasBackgroundImage: probe.propSummary.some((p) => p.startsWith("backgroundImage:")),
          }) ??
          nameFromContent(tree, "section");
        assertRoundTrips(probeName);

        const match = findReusable(registry, { hash, signature, tokens, threshold: reuseThreshold });
        let kebab;
        let result;
        let reused = false;

        // Re-running a page must still rewrite the components that page
        // introduced — otherwise the second run of `dev-page` matches its own
        // output, takes the reuse path, and the component on disk can never be
        // regenerated. Only *another* page's component is shared.
        const shareable = match && match.entry.introducedBy !== fileSlug && !used.has(match.entry.kebab);

        if (shareable) {
          // Re-emit under the registered name so this page's block, class names
          // and node map all address the component that will actually render.
          // The files are thrown away — the introducing page stays the
          // authority for the CSS, exactly as before.
          kebab = match.entry.kebab;
          result = generate(kebab);
          reused = true;
          if (!match.entry.pages.includes(fileSlug)) match.entry.pages.push(fileSlug);
        } else if (match && match.entry.introducedBy === fileSlug) {
          // This page's own component, regenerating. Keep its registered name
          // and refresh the stored shape.
          kebab = match.entry.kebab;
          result = generate(kebab);
          Object.assign(match.entry, { signature, tokens });
        } else {
          // A new shape. Take the content-derived name, stepping past any name
          // an earlier section of *this* page already used and any name another
          // structure already registered. Suffixes must be LETTERS: a digit
          // ("step-7") does not survive renderBlock's kebab->Pascal->kebab
          // round trip, so the component would register under a different key
          // than its folder and vanish from every page silently.
          kebab = probeName;
          // A name is unavailable if an earlier section of this page took it,
          // or if a *different* structure already registered it. Checking these
          // in sequence rather than together is what once let a section be
          // handed a name its own page had already used, collapsing two
          // sections into one component.
          const isFree = (n) => !used.has(n) && !(registry.names[n] && registry.names[n] !== hash);
          if (!isFree(kebab)) {
            // Spend the section's own words before falling back to a letter, so
            // a genuine second shape reads as `prose-block-reviews` rather than
            // `prose-block-b`.
            kebab = qualifiedName(probeName, tree, isFree) ?? kebab;
          }
          while (!isFree(kebab)) {
            kebab = nextName(kebab);
          }
          assertRoundTrips(kebab);
          result = generate(kebab);
          registry.components[hash] = {
            kebab,
            signature,
            tokens,
            introducedBy: fileSlug,
            pages: [fileSlug],
          };
          registry.names[kebab] = hash;
        }
        used.add(kebab);
        iconTally.resolved += result.iconReport.resolved.length;
        for (const u of result.iconReport.unresolved) iconTally.unresolved.add(u);
        const iconNote = result.iconReport.resolved.length ? `  icons=${result.iconReport.resolved.length}` : "";
        console.log(`  [${sectionIndex}] -> ${kebab}${reused ? ` (shared, ${match.why})` : ""}  props=${result.propSummary.length}${repeatNote}${iconNote}`);
        if (review) console.log(`      ⚠ ${review}`);

        ir.sections.push({ id: kebab, sectionIndex, rootClass: kebab, nodeMap: result.nodeMap });
        uncertainty.sections.push({
          sectionIndex,
          component: kebab,
          reused,
          propCount: result.propSummary.length,
          nodeCount: result.nodeMap.length,
          // Markup with no content props is a section rendered styled, sized
          // and saying nothing — the shape of a dropped heading.
          emptyish: result.nodeMap.length >= 6 && result.propSummary.length === 0,
          ...(repeats.length
            ? { repeat: {
                confidence: repeats[repeats.length - 1].repeat.confidence,
                itemCount: repeats[repeats.length - 1].repeat.itemCount,
              } }
            : {}),
          icons: {
            fuzzy: result.iconReport.resolved.filter((r) => r.confidence !== "exact").map((r) => r.to),
            unresolved: [...result.iconReport.unresolved],
          },
          ...(review ? { review } : {}),
        });
        blocks.push(result.block);
        // A shared component keeps the CSS the page that introduced it
        // measured; this page contributes only its content values. Rewriting it
        // here would make the last page to run the authority for every page
        // using it.
        if (!reused) {
          Object.assign(allFiles, Object.fromEntries(Object.entries(result.files).map(([f, c]) => [`${kebab}/${f}`, c])));
        }
      };

      for (const s of sections) {
        const selector = sectionSelector(s.n);
        let captured;
        try {
          captured = await captureSection(page, selector, { breakpoints, anchorIds });
        } catch (e) {
          console.log(`  [${s.n}] capture failed, skipping: ${e.message}`);
          continue;
        }
        // A section whose entire content is a third-party widget's error or
        // paywall notice is not content to migrate — it is the absence of
        // content. Reproducing it faithfully would carry a dead vendor message
        // onto the new site.
        const PLACEHOLDER = /subscription is required|license for .* is not active|order dental videos|please enter a valid|content unavailable/i;
        const sectionText = (function collect(node, acc) {
          if (node.text) acc.push(node.text);
          for (const c of node.children || []) collect(c, acc);
          return acc;
        })(captured.tree, []).join(" ");
        if (PLACEHOLDER.test(sectionText)) {
          console.log(`  [${s.n}] skipped — third-party placeholder ("${sectionText.replace(/\s+/g, " ").trim().slice(0, 52)}…")`);
          skippedSections.push({ index: s.n, reason: "third-party placeholder", text: sectionText.slice(0, 160) });
          continue;
        }

        // A builder can nest two of the author's own sections in one container
        // (Patient Forms holds the Dental Videos block below it), which the
        // segmenter's geometry reads as one. Split the captured section at any
        // in-page anchor targets it holds inside — the boundaries the page's own
        // nav jumps to — and route each part as its own section. A section with
        // no interior anchor comes back whole, so the common case is untouched.
        const anchorTrees = splitByAnchors(captured.tree, captured.anchors || []);
        const split = anchorTrees.length > 1;
        const nodeSetOf = (t) => {
          const set = new Set();
          (function walk(node) {
            set.add(node.n);
            for (const child of node.children || []) walk(child);
          })(t);
          return set;
        };

        for (const tree of anchorTrees) {
          // An accordion is behaviour, not markup: the panels the reader never
          // opens are the ones a captured DOM has no way to show. The target
          // already ships one (`info-blocks/faq-section` over
          // `wrappers/accordion`), so the widget is routed to it with its panels
          // and its measured design — the same trade as the carousel above.
          //
          // A section is rarely only an accordion, so it splits into the ordinary
          // runs around each widget and those go through `routeTree` unchanged.
          const ns = nodeSetOf(tree);
          const accordions = accordionRef ? (captured.accordions ?? []).filter((a) => ns.has(a.minN)) : [];
          const parts = accordions.length ? splitByAccordions(tree, accordions) : null;

          if (parts && parts.some((part) => part.kind === "accordion")) {
            const bpFirst = breakpoints[breakpoints.length - 1];
            // Prefer the band the *page* paints over the one this element
            // happens to declare: a builder puts the background on whichever
            // wrapper it likes, so a section root can be transparent inside a
            // clearly coloured band. Without this the accordion half of a split
            // section renders white beside the grey run it belongs with.
            const ownBand = captured.styles?.[bpFirst]?.[tree.n]?.styles?.backgroundColor ?? "";
            const bandColor = alphaOf(ownBand) > 0.02 ? ownBand : s.background || ownBand;
            const startedAt = blocks.length;
            // The "may be more than one component" flag reads the section's
            // height and column count, both of which this pass inflated by
            // opening every panel — an accordion is *meant* to be taller than the
            // page it sits on. Splitting it out is exactly what that flag asks
            // for, and it has now happened, so the section stops being flagged.
            accordionSections.add(s.n);
            let review = "";
            const route = (t) => {
              routeTree(t, { sectionIndex: s.n, captured, review });
              review = "";
            };

            for (let i = 0; i < parts.length; i++) {
              const part = parts[i];
              if (part.kind === "run") {
                // Held back when an accordion comes next: the run may end with
                // that accordion's own heading, which belongs on it instead.
                if (parts[i + 1]?.kind !== "accordion") route(part.tree);
                continue;
              }
              const lead = parts[i - 1]?.kind === "run" ? pullUpHeading(parts[i - 1].tree) : { heading: "", tree: null };
              if (lead.tree) route(lead.tree);

              blocks.push(
                accordionBlock(part.accordion, {
                  ref: accordionRef,
                  heading: lead.heading,
                  label: `${slug || "page"}-accordion-${s.n}`,
                  bandColor,
                  // Only where something of this section already stands above it:
                  // the two are one band in the source, and a second helping of
                  // section padding would open a gap the source never had.
                  hasLeadRun: blocks.length > startedAt,
                  branding,
                  rewriteHtml: rewriteHtmlLinks,
                })
              );
              const panels = part.accordion.items.length;
              console.log(`  [${s.n}] -> ${accordionRef} (accordion, ${panels} panel${panels === 1 ? "" : "s"})`);
            }
            continue;
          }

          routeTree(tree, {
            sectionIndex: s.n,
            captured,
            // A carousel belongs to a whole section; only trust it where the
            // section was not split into anchor parts.
            carousel: split ? false : captured.carousel,
            review: split ? "" : s.review,
          });
        }
      }

      const flagged = sections.filter((s) => s.review && !accordionSections.has(s.n));

      if (flagged.length) {
        // Left whole rather than split, and tall enough that it is probably
        // more than one design. Silently baking these into one component per
        // page is what produced 4,897-line page components on the first site
        // through this tool, so they are surfaced as a question instead.
        console.log(`\n⚠ ${flagged.length} section(s) may be more than one component — decide before accepting:`);
        for (const s of flagged) {
          console.log(`  [${s.n}] h=${s.box.h}px  "${s.textPreview.slice(0, 60)}"`);
          console.log(`      ${s.review}`);
        }
        console.log(
          "  If one of these is really several designs stacked, split it in the source or\n" +
            "  re-run that page and hand-separate the result. If it is genuinely one design,\n" +
            "  no action is needed — the flag is advisory."
        );
      }

      if (skippedSections.length) {
        console.log(`\nskipped ${skippedSections.length} placeholder section(s) — recorded in the IR`);
        ir.skipped = skippedSections;
      }

      if (iconTally.resolved || iconTally.unresolved.size) {
        console.log(`\nicons: ${iconTally.resolved} substituted from the project set` +
          (iconTally.unresolved.size ? `, ${iconTally.unresolved.size} unresolved (${[...iconTally.unresolved].join(", ")})` : ""));
      }

      const pageYaml = emitPage({
        title,
        canonical: route,
        blocks,
        mig: { v: "0.1.0", gen: "wpmig", hash: "" },
      });

      if (args["dry-run"]) {
        console.log(`\n===== ${slug}.md =====\n---\n${pageYaml}---`);
      } else {
        // A measured theme is worth nothing if the component it is emitted for
        // cannot read it. The starter's accordion predates these measurements,
        // so teach it — idempotently, and only when this page actually routed
        // something onto it.
        if (blocks.some((b) => String(b?._component || "").includes(args["accordion-section"] || "faq-section"))) {
          const { patched, skipped } = patchStarterComponents(targetRoot);
          for (const rel of patched) console.log(`patched target component: ${rel}`);
          for (const s of skipped.filter((x) => x.reason.includes("hand"))) {
            console.log(`  ! ${s.rel} — ${s.reason}`);
          }
        }

        const compDir = path.join(targetRoot, "src/components/page-sections", args.namespace);
        for (const [rel, content] of Object.entries(allFiles)) {
          const dest = path.join(compDir, rel);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, content);
        }
        // Regeneration overwrites the component files, which takes the
        // corrections region with it. Those corrections are persisted state,
        // not a by-product of the last run, so they are re-applied here —
        // otherwise every regeneration silently reverts the fidelity the
        // refine loop earned (white text reverting to black, type scale
        // snapping back) and the two stages stop composing.
        const corrections = loadState(path.join(HERE, ".wpmig/corrections", `${fileSlug}.json`));
        if (corrections.size) {
          const reapplied = applyCorrections(targetRoot, args.namespace, corrections);
          const n = reapplied.reduce((a, x) => a + x.declarations, 0);
          if (n) console.log(`re-applied ${n} persisted correction(s) across ${reapplied.length} component(s)`);
        }

        // Everything the generated output points at has to exist in the target
        // — background images in particular reach the page only through the
        // captured computed styles, so no earlier stage has seen them.
        const assets = copyReferencedAssets({
          refs: collectAssetRefs([Object.values(allFiles), blocks]),
          staticDir,
          targetRoot,
        });
        uncertainty.pageLevel.missingAssets = assets.missing;
        if (assets.copied.length || assets.missing.length) {
          console.log(`assets: ${assets.copied.length} copied` +
            (assets.missing.length ? `, ${assets.missing.length} missing from the snapshot` : ""));
          for (const ref of assets.missing.slice(0, 5)) console.log(`  ! ${ref}`);
        }

        saveRegistry(registry);

        const irDir = path.join(HERE, ".wpmig/ir");
        fs.mkdirSync(irDir, { recursive: true });
        fs.writeFileSync(path.join(irDir, `${fileSlug}.json`), JSON.stringify(ir, null, 2));

        const uncDir = path.join(HERE, ".wpmig/uncertainty");
        fs.mkdirSync(uncDir, { recursive: true });
        uncertainty.generatedAt = new Date().toISOString();
        uncertainty.pageLevel.skippedSections = skippedSections;
        fs.writeFileSync(path.join(uncDir, `${fileSlug}.json`), JSON.stringify(uncertainty, null, 2));

        const pagesDir = path.join(HERE, ".wpmig/out/pages");
        fs.mkdirSync(pagesDir, { recursive: true });
        const pagePath = path.join(pagesDir, `${slug || "index"}.md`);
        fs.mkdirSync(path.dirname(pagePath), { recursive: true });
        fs.writeFileSync(pagePath, `---\n${pageYaml}---\n`);
        console.log(`\nwrote ${blocks.length} component(s) to ${path.relative(process.cwd(), compDir)}`);
        console.log(`wrote page to ${path.relative(process.cwd(), pagePath)} (copy into src/content/pages/ manually for now)`);
      }
    } finally {
      await browser.close();
      server.close();
    }
  },
});

const devPartials = defineCommand({
  meta: {
    name: "dev-partials",
    description: "Report card grids and other repeat blocks duplicated across generated components.",
  },
  args: {
    target: { type: "string", description: "Target repo root", default: path.join(HERE, "..") },
    namespace: { type: "string", description: "Namespace under page-sections/ to scan", default: "" },
    check: { type: "boolean", description: "Exit non-zero when duplicates are found", default: false },
  },
  async run({ args }) {
    const root = path.join(path.resolve(args.target), "src/components/page-sections");

    if (!fs.existsSync(root)) throw new Error(`components dir not found: ${root}`);

    // Every emitted component, keyed by the folder it lives in.
    const components = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);

        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".astro")) {
          components.push({ name: path.relative(root, dir), source: fs.readFileSync(full, "utf8"), file: full });
        }
      }
    };
    walk(args.namespace ? path.join(root, args.namespace) : root);

    const groups = findSharedPartials(components);

    if (!groups.length) {
      console.log(`no cross-component repeat blocks in ${components.length} component(s).`);
      return;
    }

    console.log(
      `${groups.length} repeat block shape(s) duplicated across components — each is one partial living in ${groups.reduce((n, g) => n + g.members.length, 0)} places:\n`
    );
    for (const group of groups) {
      const byComponent = new Map(group.members.map((m) => [m.component, m]));

      console.log(`  ${byComponent.size} copies:`);
      for (const [name, member] of byComponent) {
        const source = components.find((c) => c.name === name).source;
        const owned = ownedClasses(source, member.classes);

        console.log(`    ${name}  (${member.classes.length} classes, ${owned.length} movable)`);
      }
      console.log(`    shape: ${group.key.slice(0, 100)}…\n`);
    }
    console.log(
      "Extract each into a shared partial under page-sections/shared-blocks/ and have every\n" +
        "member import it — otherwise a fix applied to one copy silently skips the rest."
    );
    if (args.check) process.exitCode = 1;
  },
});

const main = defineCommand({
  meta: {
    name: "wpmig",
    version: "0.1.0",
    description: "WordPress → CloudCannon Astro migrator",
  },
  subCommands: {
    "dev-generate": devGenerate,
    "dev-scan": devScan,
    "dev-page": devPage,
    "dev-extract": devExtract,
    "dev-snapshot": devSnapshot,
    "dev-visual-check": devVisualCheck,
    "dev-compare": devCompare,
    "dev-refine": devRefine,
    "dev-posts": devPosts,
    "dev-refine-all": devRefineAll,
    "dev-relink": devRelink,
    "dev-chrome": devChrome,
    "dev-partials": devPartials,
    "dev-verify": devVerify,
    "dev-refix": devRefix,
    "dev-audit": devAudit,
    "dev-triage": devTriage,
  },
});

runMain(main);
