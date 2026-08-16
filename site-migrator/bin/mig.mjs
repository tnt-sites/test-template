#!/usr/bin/env node
import { defineCommand, runMain } from "citty";
import fs from "node:fs";
import path from "node:path";
import { loadConfig, CONFIG_FILENAME } from "../src/config/load.mjs";
import { runMirror, writePathAliases } from "../src/mirror/index.mjs";
import { serve } from "../src/mirror/serve.mjs";
import { Writer } from "../src/fs/write.mjs";
import { scaffoldConfig } from "../src/config/scaffold.mjs";
import { setFrozen } from "../src/fs/provenance.mjs";

const VERSION = "0.1.0";

const sharedArgs = {
  config: { type: "string", description: `Path to ${CONFIG_FILENAME}` },
  "dry-run": { type: "boolean", description: "Show what would be written, write nothing" },
  force: { type: "boolean", description: "Overwrite frozen and externally-authored files" },
};

async function ctxFor(args) {
  const ctx = await loadConfig({ configPath: args.config });
  ctx.writer = new Writer({
    targetRoot: ctx.paths.targetRoot,
    artifactsDir: ctx.paths.artifacts,
    dryRun: Boolean(args["dry-run"]),
    force: Boolean(args.force),
    version: VERSION,
  });
  return ctx;
}

/** Raw mirrored HTML, for inferring which host the source published under. */
function readMirrorPages(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.html?$/i.test(e.name))
    .map((e) => fs.readFileSync(path.join(dir, e.name), "utf8"));
}

function reportWrites(writer) {
  const summary = writer.summary;
  if (Object.keys(summary).length === 0) {
    console.log("  (no files written)");
  } else {
    for (const [outcome, count] of Object.entries(summary)) {
      console.log(`  ${outcome}: ${count}`);
    }
  }

  for (const item of writer.needsAttention) {
    console.warn(`  ! ${item.path} — ${item.detail ?? item.outcome}`);
  }

  if (writer.dryRun) console.log("\n  dry run — nothing was written.");
  if (writer.failed) {
    console.error("\nConflicts detected. Resolve them, or re-run with --force to overwrite.");
    process.exitCode = 1;
  }
}

const init = defineCommand({
  meta: { name: "init", description: "Scaffold migration.config.yml and component-map.yml" },
  args: {
    source: { type: "string", description: "Source base URL or file:./static" },
    force: { type: "boolean", description: "Overwrite existing config files" },
  },
  async run({ args }) {
    const { written, detected } = scaffoldConfig(process.cwd(), {
      source: args.source,
      force: Boolean(args.force),
    });
    for (const f of written) console.log(`  created ${f}`);
    if (written.length === 0) {
      console.log(`  ${CONFIG_FILENAME} already exists (use --force to overwrite)`);
    }

    if (detected) {
      console.log(
        `\n  detected ${detected.stylesheets.length} stylesheet(s) and ` +
          `${detected.scripts.length} script(s) from the source.`
      );
      console.log("  Run `mig mirror` then `mig detect` to fill in the section selectors.");
    }
  },
});

const mirror = defineCommand({
  meta: {
    name: "mirror",
    description: "Crawl the source and stamp every element with a stable uid",
  },
  args: {
    ...sharedArgs,
    refresh: { type: "boolean", description: "Accept source changes without reporting uid drift" },
  },
  async run({ args }) {
    const ctx = await ctxFor(args);
    const result = await runMirror(ctx, { refresh: Boolean(args.refresh) });
    writePathAliases(result.instrumentedDir, result.pages);

    const totalElements = result.pages.reduce((n, p) => n + p.elements, 0);
    console.log(`Mirrored ${result.pages.length} pages, stamped ${totalElements} elements.`);
    console.log(`  raw:          ${path.relative(process.cwd(), result.mirrorDir)}`);
    console.log(`  instrumented: ${path.relative(process.cwd(), result.instrumentedDir)}`);

    if (result.drift.length) {
      console.warn(
        `\n! Source HTML changed since the last mirror for ${result.drift.length} page(s):`
      );
      for (const id of result.drift.slice(0, 10)) console.warn(`    ${id}`);
      console.warn("  uids on these pages have been renumbered. Re-run `mig scan`.");
    }
  },
});

const serveCmd = defineCommand({
  meta: { name: "serve", description: "Serve the instrumented mirror" },
  args: {
    ...sharedArgs,
    port: { type: "string", description: "Port to listen on", default: "8080" },
  },
  async run({ args }) {
    const ctx = await ctxFor(args);
    const dir = path.join(ctx.paths.artifacts, "instrumented");
    if (!fs.existsSync(dir)) throw new Error("No mirror found. Run `mig mirror` first.");

    const { url } = await serve(dir, Number(args.port));
    console.log(`Serving instrumented mirror at ${url}`);
    console.log("Press Ctrl+C to stop.");
    await new Promise(() => {});
  },
});

const tokens = defineCommand({
  meta: {
    name: "tokens",
    description: "Derive the theme layer (palette, neutral ramp, fonts) from the source",
  },
  args: {
    ...sharedArgs,
    "sample-pages": { type: "string", description: "How many pages to measure", default: "6" },
    "report-only": { type: "boolean", description: "Extract and report, write nothing" },
  },
  async run({ args }) {
    const ctx = await ctxFor(args);
    const { runTokens, emitTokens, emitSemanticOverrides, brandingPatch } = await import(
      "../src/css/tokens/index.mjs"
    );
    const { patchRegion } = await import("../src/fs/regions.mjs");

    const { artifact, css } = await runTokens(ctx, { sampleLimit: Number(args["sample-pages"]) });

    console.log(`Root font-size: ${artifact.rootFontSizePx}px` +
      (artifact.rootFontSizePx !== 16
        ? `  (${artifact.remConversions} rem values converted to px, ${artifact.rootFontSizeRulesDropped} root rules dropped)`
        : ""));
    console.log("\nRoles:");
    for (const [role, hex] of Object.entries(artifact.roles)) {
      console.log(`  ${role.padEnd(16)} ${hex}`);
    }
    if (artifact.extras.length) {
      console.log(`\nUnnamed colours worth tokens: ${artifact.extras.map((e) => e.hex).join(", ")}`);
    }
    if (artifact.ramp) console.log(`\nNeutral ramp: ${artifact.ramp[0]} -> ${artifact.ramp.at(-1)}`);
    if (artifact.fontServices.length) {
      console.log(`Font services: ${artifact.fontServices.join(", ")}`);
    }

    if (args["report-only"]) {
      console.log(`\nreport-only — see ${path.join(".migration", "tokens", "palette.json")}`);
      return;
    }

    const w = ctx.writer;
    const styles = path.relative(ctx.paths.targetRoot, ctx.paths.styles);

    w.write(path.join(styles, "source/_tokens.pcss"), emitTokens(artifact), { gen: "tokens" });
    if (artifact.ramp) {
      const { emitRamp } = await import("../src/css/tokens/ramp.mjs");
      w.write(path.join(styles, "source/_ramp.pcss"), emitRamp(artifact.ramp), { gen: "tokens" });
    }

    // Semantic overrides and the layer order are edits to files the toolkit
    // only partly owns, so they go through marked regions.
    patchRegion(
      w,
      ctx.paths.targetRoot,
      path.join(styles, "themes/_default.pcss"),
      "source-theme",
      emitSemanticOverrides(artifact)
      // No anchor: the override rule is appended at end of file so it wins on
      // source order against the theme's own declarations.
    );

    // Port the source's global element styling. Tokens carry colour and font
    // family; this carries the typography and rhythm that never reach a token.
    {
      const { collectBaseRules, emitSourceBase, assetsInBaseRules } = await import(
        "../src/css/source-base.mjs"
      );
      const { collectAssets } = await import("../src/css/assets.mjs");

      const baseRules = collectBaseRules(css.rules, { rootPx: artifact.rootFontSizePx });

      // Assets referenced by those rules have to travel with them.
      const assets = collectAssets(
        baseRules.map((r) => ({ decls: r.decls, sheetUrl: r.sheetUrl })),
        {
          mirrorDir: path.join(ctx.paths.artifacts, "instrumented"),
          writer: w,
          publicDir: path.relative(ctx.paths.targetRoot, ctx.paths.public),
        }
      );

      const baseCss = emitSourceBase(baseRules, { assetMap: assets.map });
      if (baseCss) {
        w.write(path.join(styles, "source/_source-base.pcss"), baseCss, { gen: "tokens" });
        console.log(
          `\nPorted ${baseRules.length} global element rule(s)` +
            (assets.map.size ? `, ${assets.map.size} asset(s)` : "")
        );
        if (assets.missing.length) {
          console.warn(`  ! ${assets.missing.length} referenced asset(s) not found in the mirror`);
        }
      }
    }

    // Generated stylesheets do nothing until the entry point imports them and
    // the cascade layers are declared, so wiring is part of the same command.
    const { wireStyleImports, wireLayerOrder, patchJson } = await import(
      "../src/css/tokens/wire.mjs"
    );

    const imports = wireStyleImports(w, ctx.paths.targetRoot, styles);
    if (!imports.ok) console.warn(`  ! ${imports.reason}`);

    const layers = wireLayerOrder(w, ctx.paths.targetRoot, ctx.preset.layerOrder.file);
    if (!layers.ok) console.warn(`  ! ${layers.reason}`);
    else console.log(`\nLayer order: @layer ${layers.layers.join(", ")};`);

    const patch = brandingPatch(artifact, artifact.measured);
    const dataDir = path.relative(ctx.paths.targetRoot, ctx.paths.data);
    const branding = patchJson(
      w,
      ctx.paths.targetRoot,
      path.join(dataDir, "branding.json"),
      patch,
      // The source site is authoritative for branding: the template's values
      // are stand-ins, not preferences to preserve.
      { replaceKeys: Object.keys(patch) }
    );
    if (!branding.ok) {
      console.warn(`  ! ${branding.reason}; apply this by hand:`);
      console.warn(JSON.stringify(patch, null, 2));
    }

    console.log("");
    reportWrites(w);
  },
});

const behaviors = defineCommand({
  meta: {
    name: "behaviors",
    description: "Recover carousel/accordion settings from the source JavaScript",
  },
  args: sharedArgs,
  async run({ args }) {
    const ctx = await ctxFor(args);
    const { scanScripts, mapToProps } = await import("../src/behaviors/scan-js.mjs");

    const mirrorDir = path.join(ctx.paths.artifacts, "instrumented");
    if (!fs.existsSync(mirrorDir)) throw new Error("No mirror found. Run `mig mirror` first.");

    const { behaviors: found, errors } = scanScripts(ctx.config.source.scripts, {
      mirrorDir,
      pluginNames: ctx.config.behaviors.jsPluginCalls,
    });

    if (ctx.config.source.scripts.length === 0) {
      console.log("No scripts configured. Add them under `source.scripts`.");
      return;
    }

    const report = [];
    for (const b of found) {
      if (Object.keys(b.options).length === 0) continue;
      const { props, unmapped } = mapToProps(b, ctx.config.behaviors.propMap);
      report.push({ ...b, props, unmapped });

      console.log(`\n${b.plugin}  ${b.selector ?? "(selector not resolvable)"}`);
      for (const [k, v] of Object.entries(props)) console.log(`  ${k} = ${JSON.stringify(v)}`);
      for (const u of unmapped) {
        console.log(`  ! ${u.option} = ${JSON.stringify(u.value)} — ${u.reason}`);
      }
    }

    for (const e of errors) console.warn(`! ${e.script}: ${e.reason}`);

    const out = path.join(ctx.paths.artifacts, "behaviors.json");
    fs.mkdirSync(ctx.paths.artifacts, { recursive: true });
    fs.writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(`\nWrote ${path.relative(process.cwd(), out)}`);
  },
});

const scan = defineCommand({
  meta: {
    name: "scan",
    description: "Segment every page and cluster the sections into visual patterns",
  },
  args: sharedArgs,
  async run({ args }) {
    const ctx = await ctxFor(args);
    const { runScan, checkClusterHealth, renderContactSheet } = await import(
      "../src/sections/index.mjs"
    );

    const artifact = await runScan(ctx);

    console.log(
      `${artifact.sectionCount} sections across ${artifact.pagesScanned} pages ` +
        `-> ${artifact.clusterCount} clusters\n`
    );

    for (const c of artifact.clusters) {
      const varies = Object.keys(c.variance);
      console.log(
        `  ${c.id.padEnd(28)} ${String(c.members.length).padStart(3)} member(s)` +
          (varies.length ? `   varies: ${varies.join(", ")}` : "")
      );
    }

    if (artifact.emptyPages?.length) {
      console.warn(
        `\n! ${artifact.emptyPages.length} page(s) found no sections and will migrate empty:`
      );
      for (const id of artifact.emptyPages.slice(0, 12)) console.warn(`    ${id}`);
      console.warn("  Run `mig detect` again, or add a rule for their layout.");
    }

    for (const f of artifact.failures) console.warn(`\n! ${f.page}: ${f.reason}`);

    const sheet = path.join(ctx.paths.artifacts, "scan", "contact-sheet.html");
    fs.writeFileSync(sheet, renderContactSheet(artifact));
    console.log(`\nContact sheet: ${path.relative(process.cwd(), sheet)}`);

    // Write the map itself rather than leaving it to be typed. Every entry is
    // a proposal derived from what the target library can hold; the operator
    // reviews rather than authors.
    const { loadComponentCatalog, renderSuggestions } = await import(
      "../src/sections/suggest.mjs"
    );
    const catalog = loadComponentCatalog(ctx.paths.components);
    const mapPath = ctx.paths.componentMapPath;
    const existing = Object.keys(ctx.componentMap.clusters ?? {});

    if (existing.length === 0) {
      const body = renderSuggestions(artifact.clusters, catalog);
      const header = [
        "# Cluster -> library component, proposed by `mig scan`.",
        "#",
        "# Each entry is the component whose props best fit what the cluster",
        "# actually contains. Review before running `mig content`: alternatives",
        "# and anything a component cannot hold are noted inline.",
        "",
        "clusters:",
        "",
      ].join("\n");
      if (!ctx.writer.dryRun) fs.writeFileSync(mapPath, header + body);
      console.log(
        `\nProposed a mapping for all ${artifact.clusters.length} clusters in ` +
          `${path.basename(mapPath)} — review it, then run \`mig content\`.`
      );
    } else {
      const unmapped = artifact.clusters.filter((c) => !existing.includes(c.id));
      if (unmapped.length) {
        console.log(`\n${unmapped.length} cluster(s) not yet in ${path.basename(mapPath)}:`);
        for (const c of unmapped) console.log(`  ${c.id}`);
      }
    }

    const problems = checkClusterHealth(artifact, ctx.config);
    for (const p of problems) console.error(`\n! ${p}`);
    if (problems.length) process.exitCode = 1;
  },
});

const content = defineCommand({
  meta: {
    name: "content",
    description: "Pull source content into the nearest mapped library component",
  },
  args: {
    ...sharedArgs,
    only: { type: "string", description: "Migrate a single page by id" },
    "keep-existing": {
      type: "boolean",
      description: "Do not replace pages the template already ships",
    },
  },
  async run({ args }) {
    const ctx = await ctxFor(args);
    // The migrated site's content is authoritative over the template's demo
    // pages, which share names like index.md and about-us.md.
    ctx.writer.adoptExternal = !args["keep-existing"];

    const { runContent, renderPage, collectContentAssets, rewriteBlockLinks } = await import(
      "../src/content/index.mjs"
    );
    const { detectSourceHost } = await import("../src/content/links.mjs");
    const { detectTitleSuffix, stripTitleSuffix } = await import("../src/content/seo.mjs");

    const { results, failures } = await runContent(ctx, { only: args.only });

    const suffix = detectTitleSuffix(results.map((r) => r.seo?.title));
    if (suffix) console.log(`Stripping shared title suffix: "${suffix}"\n`);

    const w = ctx.writer;
    const contentDir = path.relative(ctx.paths.targetRoot, ctx.paths.content);

    // Rewrite legacy URLs here, not only in `mig links`, so regenerating is
    // stable rather than ping-ponging with the link pass.
    {
      const { pages } = JSON.parse(
        fs.readFileSync(path.join(ctx.paths.artifacts, "pages.json"), "utf8")
      );
      const rawDir = path.join(ctx.paths.artifacts, "mirror");
      const sourceHost = ctx.config.source.base.startsWith("http")
        ? ctx.config.source.base.replace(/\/$/, "")
        : detectSourceHost(
            fs.existsSync(rawDir)
              ? fs.readdirSync(rawDir).map((f) => fs.readFileSync(path.join(rawDir, f), "utf8"))
              : [],
            pages
          );
      const rewritten = rewriteBlockLinks(results, { pages, sourceHost });
      if (rewritten) console.log(`${rewritten} legacy link(s) rewritten.`);
    }

    // A structure-value's seeded example can name an icon the target does not
    // have; copied onto every page it breaks the build.
    const { loadIconSet, validateIcons, iconsDirFor } = await import(
      "../src/content/validate-icons.mjs"
    );
    // The validator must know every name the target can render, or it clears
    // correct icon-font names for not being outline icons.
    const { loadFontelloNames } = await import("../src/content/resolve-icon.mjs");
    const fontelloComponent = path.join(
      ctx.paths.components,
      "building-blocks/core-elements/fontello-icon/FontelloIcon.astro"
    );
    const fontelloNames = fs.existsSync(fontelloComponent)
      ? loadFontelloNames(fs.readFileSync(fontelloComponent, "utf8"))
      : null;

    const outlineIcons = loadIconSet(iconsDirFor(ctx.paths.targetRoot));
    const iconSet = outlineIcons
      ? new Set([...outlineIcons, ...(fontelloNames ?? [])])
      : fontelloNames;

    if (iconSet) {
      const icons = { replaced: [], cleared: [] };
      for (const r of results) {
        const outcome = validateIcons(r.blocks, iconSet);
        icons.replaced.push(...outcome.replaced);
        icons.cleared.push(...outcome.cleared);
      }
      const approximated = [...new Set(results.flatMap((r) => r.approximatedIcons ?? []))];
      if (approximated.length) {
        console.log(`Icons approximated from the source font: ${approximated.join(", ")}`);
      }
      const swaps = [...new Set(icons.replaced.map((i) => `${i.from} -> ${i.to}`))];
      const gone = [...new Set(icons.cleared)];
      if (swaps.length) console.log(`Icons remapped: ${swaps.join(", ")}`);
      if (gone.length) console.warn(`! Icons cleared (no match): ${gone.join(", ")}`);
    }

    const assets = collectContentAssets(results, {
      mirrorDir: path.join(ctx.paths.artifacts, "instrumented"),
      writer: w,
      publicDir: path.relative(ctx.paths.targetRoot, ctx.paths.public),
    });
    console.log(`${assets.map.size} content images copied.`);
    if (assets.missing.length) {
      console.warn(`! ${assets.missing.length} referenced image(s) not found in the mirror`);
    }
    let mapped = 0;
    let skipped = 0;

    for (const result of results) {
      if (suffix && result.seo?.title) {
        result.seo.title = stripTitleSuffix(result.seo.title, suffix);
      }
      mapped += result.blocks.length;
      skipped += result.notes.filter((n) => n.reason).length;

      w.write(path.join(contentDir, "pages", `${result.page.id}.md`), renderPage(result), {
        gen: "content",
      });
    }

    console.log(`${results.length} pages, ${mapped} sections mapped to components.`);
    if (skipped) console.log(`${skipped} sections had no mapping (see below).`);

    // Show which clusters still need a line in component-map.yml.
    const unmappedClusters = {};
    for (const r of results) {
      for (const n of r.notes) {
        if (!n.reason) continue;
        unmappedClusters[n.cluster] = (unmappedClusters[n.cluster] ?? 0) + 1;
      }
    }
    const pending = Object.entries(unmappedClusters).sort((a, b) => b[1] - a[1]);
    if (pending.length) {
      console.log("\nClusters still needing a component-map.yml entry:");
      for (const [cluster, count] of pending) {
        console.log(`  ${String(cluster).padEnd(28)} ${count} section(s)`);
      }

      // Every site brings its own sections, so rank what the library can
      // actually hold rather than leaving the operator to read 46 components.
      const { loadComponentCatalog, renderSuggestions } = await import(
        "../src/sections/suggest.mjs"
      );
      const scanFile = path.join(ctx.paths.artifacts, "scan", "clusters.json");
      const scan = JSON.parse(fs.readFileSync(scanFile, "utf8"));
      const unmapped = scan.clusters.filter((c) => pending.some(([id]) => id === c.id));
      const catalog = loadComponentCatalog(ctx.paths.components);

      const suggestions = renderSuggestions(unmapped, catalog);
      const file = path.join(ctx.paths.artifacts, "suggested-component-map.yml");
      fs.writeFileSync(file, `clusters:\n${suggestions}`);
      console.log(
        `\nSuggested mappings written to ${path.relative(process.cwd(), file)} — ` +
          `review and paste into component-map.yml.`
      );
    }

    for (const f of failures) console.warn(`\n! ${f.page.id}: ${f.reason}`);

    console.log("");
    reportWrites(w);
  },
});

const links = defineCommand({
  meta: { name: "links", description: "Rewrite legacy .html URLs in migrated content" },
  args: sharedArgs,
  async run({ args }) {
    const ctx = await ctxFor(args);
    const { buildUrlMap, rewriteContentFiles, detectSourceHost } = await import(
      "../src/content/links.mjs"
    );

    const { pages } = JSON.parse(
      fs.readFileSync(path.join(ctx.paths.artifacts, "pages.json"), "utf8")
    );
    // Migrating from a local mirror leaves no configured host to match the
    // content's absolute self-links against, so infer it from the content.
    let sourceHost = ctx.config.source.base.startsWith("http")
      ? ctx.config.source.base.replace(/\/$/, "")
      : null;

    if (!sourceHost) {
      const texts = [];
      const collect = (dir) => {
        if (!fs.existsSync(dir)) return;
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) collect(full);
          else if (/\.mdx?$/.test(e.name)) texts.push(fs.readFileSync(full, "utf8"));
        }
      };
      collect(ctx.paths.content);
      sourceHost = detectSourceHost(texts, pages);
      if (sourceHost) console.log(`Detected source host: ${sourceHost}`);
    }

    const map = buildUrlMap(pages, { sourceHost });
    const result = rewriteContentFiles(ctx.paths.content, map, {
      writer: ctx.writer,
      targetRoot: ctx.paths.targetRoot,
    });

    console.log(`Rewrote ${result.changes} link(s) across ${result.files} file(s).`);
    if (result.unresolved.length) {
      console.warn(`\n! ${result.unresolved.length} legacy URL(s) with no mapping, left as-is:`);
      for (const u of result.unresolved.slice(0, 15)) console.warn(`    ${u}`);
    }

    console.log("");
    reportWrites(ctx.writer);
  },
});

const redirects = defineCommand({
  meta: { name: "redirects", description: "Emit redirects from the legacy URLs to the new routes" },
  args: {
    ...sharedArgs,
    "astro-config": {
      type: "boolean",
      description:
        "Also write a redirects block into astro.config.mjs (builds a static page per redirect; collides with /index.html)",
    },
  },
  async run({ args }) {
    const ctx = await ctxFor(args);
    const { buildRedirects, renderRedirectsFile, renderAstroRedirects } = await import(
      "../src/content/links.mjs"
    );
    const { patchRegion } = await import("../src/fs/regions.mjs");

    const { pages } = JSON.parse(
      fs.readFileSync(path.join(ctx.paths.artifacts, "pages.json"), "utf8")
    );
    const table = buildRedirects(pages);
    const count = Object.keys(table).length;

    const w = ctx.writer;
    const publicDir = path.relative(ctx.paths.targetRoot, ctx.paths.public);

    // `_redirects` is what actually takes effect when the site is hosted.
    w.write(path.join(publicDir, "_redirects"), renderRedirectsFile(table), { gen: "redirects" });

    // Astro's own `redirects` option emits a static page per source, so a
    // legacy `/index.html` collides with the real homepage file and fails the
    // build. `_redirects` is what the host honours, so that is the default.
    if (args["astro-config"]) {
      try {
        patchRegion(
          w,
          ctx.paths.targetRoot,
          "astro.config.mjs",
          "redirects",
          renderAstroRedirects(table),
          { after: /defineConfig\(\{/ }
        );
      } catch (e) {
        console.warn(`  ! ${e.message}`);
      }
    }

    console.log(`${count} redirect(s) emitted.`);
    console.log("");
    reportWrites(w);
  },
});

const chrome = defineCommand({
  meta: {
    name: "chrome",
    description: "Fill the header, footer and site-info data from the source site",
  },
  args: {
    ...sharedArgs,
    from: { type: "string", description: "Page to read chrome from", default: "index" },
    "no-styles": { type: "boolean", description: "Skip porting header/footer styling" },
    "report-only": { type: "boolean", description: "Extract and report, write nothing" },
  },
  async run({ args }) {
    const ctx = await ctxFor(args);
    const {
      runChrome,
      buildNavData,
      buildFooterData,
      buildSiteInfo,
      countNav,
      collectChromeAssets,
      collectStyleAssets,
    } = await import("../src/chrome/index.mjs");
    const { patchJson } = await import("../src/css/tokens/wire.mjs");

    const { extracted, styles, sourcePage } = await runChrome(ctx, { from: args.from });
    console.log(`Read chrome from ${sourcePage}.`);

    if (extracted.header) {
      console.log(`  nav:      ${countNav(extracted.header.nav)} item(s)`);
      console.log(`  logo:     ${extracted.header.logo?.source ?? "(none found)"}`);
      if (extracted.header.phones.length) {
        console.log(`  phone:    ${extracted.header.phones.map((p) => p.number).join(", ")}`);
      }
    } else {
      console.warn("  ! No header matched `segmentation.chrome.header`.");
    }

    if (extracted.footer) {
      console.log(`  footer:   ${extracted.footer.links.length} link(s), ${extracted.footer.socials.length} social(s)`);
    } else {
      console.warn("  ! No footer matched `segmentation.chrome.footer`.");
    }

    if (args["report-only"]) return;

    const w = ctx.writer;
    const dataDir = path.relative(ctx.paths.targetRoot, ctx.paths.data);

    const assets = collectChromeAssets(extracted, {
      mirrorDir: path.join(ctx.paths.artifacts, "instrumented"),
      writer: w,
      publicDir: path.relative(ctx.paths.targetRoot, ctx.paths.public),
    });
    if (assets.copied.length) console.log(`  ${assets.copied.length} logo image(s) copied.`);
    if (assets.missing.length) console.warn(`  ! not found: ${assets.missing.join(", ")}`);
    const read = (name) => {
      const file = path.join(ctx.paths.targetRoot, dataDir, name);
      return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
    };

    // The source site is authoritative for its own navigation and contact
    // details, so these replace the template's sample data outright.
    const nav = buildNavData(extracted, read("mainNav.json"));
    const footer = buildFooterData(extracted, read("footer.json"));
    const site = buildSiteInfo(extracted, read("siteInfo.json"));

    patchJson(w, ctx.paths.targetRoot, path.join(dataDir, "mainNav.json"), nav, {
      replaceKeys: Object.keys(nav),
    });
    patchJson(w, ctx.paths.targetRoot, path.join(dataDir, "footer.json"), footer, {
      replaceKeys: Object.keys(footer),
    });
    patchJson(w, ctx.paths.targetRoot, path.join(dataDir, "siteInfo.json"), site, {
      replaceKeys: Object.keys(site),
    });

    // Port the visual identity of the chrome: colours, type and band
    // backgrounds. Layout stays the template's.
    if (!args["no-styles"] && styles) {
      const { emitChromeStyles } = await import("../src/chrome/styles.mjs");
      const paletteFile = path.join(ctx.paths.artifacts, "tokens", "palette.json");
      const palette = fs.existsSync(paletteFile)
        ? semanticPalette(JSON.parse(fs.readFileSync(paletteFile, "utf8")))
        : null;

      // Background graphics referenced only by CSS have to be copied too.
      const styleAssets = collectStyleAssets(styles, {
        mirrorDir: path.join(ctx.paths.artifacts, "instrumented"),
        writer: w,
        publicDir: path.relative(ctx.paths.targetRoot, ctx.paths.public),
      });
      if (styleAssets.map.size) {
        console.log(`  ${styleAssets.map.size} background image(s) copied.`);
      }
      if (styleAssets.missing.length) {
        console.warn(`  ! background image(s) not found: ${styleAssets.missing.join(", ")}`);
      }

      const css = emitChromeStyles(styles, {
        targetSelectors: ctx.preset.chromeTargets,
        palette,
        maxDeltaE: ctx.config.css.tokenize.maxDeltaE,
        assetMap: styleAssets.map,
      });

      if (css) {
        const stylesDir = path.relative(ctx.paths.targetRoot, ctx.paths.styles);
        w.write(path.join(stylesDir, "source/_chrome.pcss"), css, { gen: "chrome" });

        // Wire the import here as well: `chrome` can run after `tokens`, and a
        // stylesheet nothing imports has no effect.
        const { wireStyleImports } = await import("../src/css/tokens/wire.mjs");
        const wired = wireStyleImports(w, ctx.paths.targetRoot, stylesDir);
        if (!wired.ok) console.warn(`  ! ${wired.reason}`);

        console.log(`  chrome styling: ${Object.keys(styles).length} role(s) ported`);
      } else {
        console.warn("  ! No chrome styling measured; check `segmentation.chrome` selectors.");
      }
    }

    console.log("");
    reportWrites(w);
  },
});

/** Map extracted palette roles onto the template's semantic variable names. */
function semanticPalette(artifact) {
  const r = artifact.roles ?? {};
  const palette = {};
  const add = (variable, hex) => {
    if (hex) palette[variable] = hex;
  };

  add("--color-brand", r.brand);
  add("--color-brand-secondary", r.brandSecondary);
  add("--color-brand-muted", r.brandMuted);
  add("--color-brand-subtle", r.brandSubtle);
  add("--color-bg", r.bgPage);
  add("--color-text", r.text);
  add("--color-link", r.link);
  for (const extra of artifact.extras ?? []) add(`--src-${extra.name}`, extra.hex);

  return palette;
}

const qa = defineCommand({
  meta: {
    name: "qa",
    description:
      "Compare the migrated page against the source: chrome geometry, nav labels, responsiveness, section heights and surfaces, heading type, image scale, carousel controls, content props",
  },
  args: {
    ...sharedArgs,
    target: { type: "string", description: "Base URL of the built site", default: "" },
    from: { type: "string", description: "Source page to compare", default: "index" },
    tolerance: { type: "string", description: "Geometry tolerance in px", default: "12" },
    widths: {
      type: "string",
      description: "Comma-separated viewport widths for the overflow check",
      default: "",
    },
  },
  async run({ args }) {
    const ctx = await ctxFor(args);
    const { chromium } = await import("playwright");
    const { serve } = await import("../src/mirror/serve.mjs");
    const { measureLayout, compareLayout } = await import("../src/qa/shot.mjs");
    const {
      readNavLabels,
      compareNavLabels,
      findOverflow,
      findDemoContent,
      findLabelIssues,
      DEFAULT_WIDTHS,
    } = await import("../src/qa/chrome.mjs");
    const { readSectionIds, measureSections, compareSections, residual } = await import(
      "../src/qa/sections.mjs"
    );
    const { readHeadings, compareHeadings } = await import("../src/qa/headings.mjs");
    const { readSurfaces, compareSurfaces } = await import("../src/qa/surfaces.mjs");
    const { readControls, compareControls, hasControls } = await import("../src/qa/controls.mjs");
    const { findBrokenImages, readImageBoxes, compareImageBoxes } = await import(
      "../src/qa/assets.mjs"
    );
    const { auditContentProps } = await import("../src/qa/props.mjs");

    const dist = path.join(ctx.paths.targetRoot, "dist");
    if (!args.target && !fs.existsSync(dist)) {
      throw new Error("No built site found. Run the site's build first, or pass --target.");
    }

    const mirrorDir = path.join(ctx.paths.artifacts, "instrumented");
    const source = await serve(mirrorDir, 0);
    const target = args.target ? null : await serve(dist, 0);
    const targetBase = args.target || target.url;

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    // Roles are paired by name: the source selectors come from config, the
    // target's from the preset, so neither side is hardcoded here.
    const sourceSelectors = {
      header: ctx.config.segmentation.chrome.header,
      footer: ctx.config.segmentation.chrome.footer,
      logo: `${ctx.config.segmentation.chrome.header} img`,
      nav: `${ctx.config.segmentation.chrome.header} nav`,
    };
    const targetSelectors = {
      header: ctx.preset.chromeTargets.headerBackground,
      footer: ctx.preset.chromeTargets.footerBackground,
      logo: ctx.preset.chromeTargets.logo,
      nav: ctx.preset.chromeTargets.navLink.replace(/\s*>?\s*ul.*$/, ""),
    };

    let failed = false;
    try {
      const a = await measureLayout(page, `${source.url}/${args.from}.html`, sourceSelectors);
      const b = await measureLayout(page, `${targetBase}/`, targetSelectors);

      if (!a.ok || !b.ok) throw new Error(a.reason || b.reason);

      console.log("Chrome geometry, source vs migrated:\n");
      for (const row of compareLayout(a.boxes, b.boxes, { tolerancePx: Number(args.tolerance) })) {
        const mark = row.status === "match" ? "  ok  " : "  --  ";
        console.log(`${mark} ${row.role.padEnd(8)} ${JSON.stringify(row.deltas ?? row.detail)}`);
        if (row.status !== "match") failed = true;
      }

      // Vertical offset between pages is expected; only size and horizontal
      // placement are comparable across a source and its migration.
      console.log("\n(y deltas include page-length differences and are informational)");

      // --- Nav labels -----------------------------------------------------
      // Geometry can match perfectly while every dropdown carries the wrong
      // name, so the text is compared separately from the boxes.
      const sourceNav = await readNavLabels(
        page,
        `${source.url}/${args.from}.html`,
        `${ctx.config.segmentation.chrome.header} nav`
      );
      const targetNav = await readNavLabels(
        page,
        `${targetBase}/`,
        targetSelectors.nav
      );

      if (sourceNav.ok && targetNav.ok) {
        const rows = compareNavLabels(sourceNav.labels, targetNav.labels);
        const wrong = rows.filter((row) => row.status !== "match");

        console.log("\nTop-level nav labels, source vs migrated:\n");
        if (wrong.length === 0) {
          console.log(`  ok   all ${rows.length} label(s) match`);
        } else {
          for (const row of wrong) {
            console.log(
              `  --   [${row.index}] ${row.status.padEnd(8)} source: ${row.source ?? "—"}  migrated: ${row.target ?? "—"}`
            );
          }
          console.log(
            "\n  A renamed top-level item usually means the chrome extractor took a\n" +
              "  dropdown's first child label for its parent — they share an href."
          );
          failed = true;
        }
      }

      // --- Responsiveness -------------------------------------------------
      // Rebuilding the source's desktop chrome introduces fixed pixel columns.
      // Ungated, they overflow a phone viewport, and a desktop screenshot
      // never shows it.
      const widths = args.widths
        ? args.widths
            .split(",")
            .map((value) => Number(value.trim()))
            .filter((value) => Number.isFinite(value) && value > 0)
        : DEFAULT_WIDTHS;

      const overflow = await findOverflow(page, `${targetBase}/`, widths);
      console.log("\nHorizontal overflow on the migrated site:\n");
      for (const row of overflow) {
        const mark = row.overflow ? "  --  " : "  ok  ";
        console.log(
          `${mark} ${String(row.width).padStart(4)}px  document ${String(row.doc).padStart(5)}px`
        );
        if (row.overflow) failed = true;
      }
      if (overflow.some((row) => row.overflow)) {
        console.log(
          "\n  Gate the chrome layout rebuild behind a desktop media query — fixed\n" +
            "  columns from the source's desktop design cannot fit these widths."
        );
      }

      // --- Leftover starter content ---------------------------------------
      await page.setViewportSize({ width: 1440, height: 900 });
      const demo = await findDemoContent(
        page,
        `${targetBase}/`,
        ctx.preset.demoContentMarkers ?? [],
        [ctx.preset.chromeTargets.headerBackground, ctx.preset.chromeTargets.footerBackground]
      );

      if (demo.ok && demo.hits.length > 0) {
        console.log("\nStarter-template content still in the chrome:\n");
        for (const hit of demo.hits) console.log(`  --   ${hit}`);
        console.log(
          "\n  These come from the template's own data files, where `mig chrome`\n" +
            "  left fields the source had no equivalent for. Fill them in by hand."
        );
        failed = true;
      }

      // --- Form label accessibility ----------------------------------------
      // Both faults below build and render fine — the control still works
      // with a mouse — so nothing else here can see them. Checked against the
      // whole page, not just the header/footer regions, since a migration's
      // own hand-ported chrome overrides can introduce the same shape.
      const labelIssues = await findLabelIssues(page, `${targetBase}/`);

      if (labelIssues.ok) {
        console.log("\nForm label accessibility on the migrated site:\n");
        if (labelIssues.issues.length === 0) {
          console.log("  ok   no empty or duplicated form labels");
        } else {
          for (const issue of labelIssues.issues) {
            if (issue.type === "empty-label") {
              console.log(
                `  --   ${issue.element} is a label with no accessible name` +
                  (issue.for ? ` (for="${issue.for}")` : "")
              );
            } else {
              console.log(`  --   ${issue.element} has ${issue.count} labels pointing at it`);
            }
          }
          console.log(
            "\n  An empty label (no text, no aria-label) reads as blank to a screen\n" +
              "  reader — give it an aria-label describing what it does.\n" +
              "\n  Multiple labels usually means two controls in a checkbox-hack pattern\n" +
              "  (e.g. a mobile nav's open and close buttons) both kept `for` pointing\n" +
              "  at the same checkbox. If JS already handles the click (check for\n" +
              "  `preventDefault`), drop `for` from all but one and give the rest\n" +
              "  `role=\"button\"` plus their own `aria-label` instead."
          );
          failed = true;
        }
      }

      // --- Section geometry -----------------------------------------------
      // For a bespoke page ported section-by-section, height is the thing that
      // goes wrong silently: a dropped media-query wrapper, a plugin stylesheet
      // that never came across, a heading margin the template adds and the
      // source does not. Each of those leaves the page rendering and the build
      // passing, with one section the wrong size.
      const targetPath = args.from === "index" ? "/" : `/${args.from}/`;
      const roots = ctx.config.segmentation.roots ?? ["main"];
      const sourceIds = await readSectionIds(page, `${source.url}/${args.from}.html`, roots);

      if (sourceIds.ok && sourceIds.ids.length > 0) {
        const a = await measureSections(page, `${source.url}/${args.from}.html`, sourceIds.ids);
        const b = await measureSections(page, `${targetBase}${targetPath}`, sourceIds.ids);

        if (!a.ok || !b.ok) {
          console.log(`\nSection heights on /${args.from}: not compared\n`);
          console.log(`  --   ${a.ok ? b.reason : a.reason}`);
          console.log(
            `\n  The migrated page is served from dist/ — check the slug matches\n` +
              `  (\`--from\` is the source page name) and that the build is current.`
          );
          failed = true;
        } else {
          const rows = compareSections(a.sections, b.sections, {
            tolerancePx: Number(args.tolerance),
          });

          console.log(`\nSection heights on /${args.from}, source vs migrated:\n`);
          for (const row of rows) {
            if (row.status === "missing") {
              console.log(`  --   ${row.id.padEnd(16)} absent in migrated page`);
              failed = true;
              continue;
            }
            const mark = row.status === "match" ? "  ok  " : "  --  ";
            console.log(
              `${mark} ${row.id.padEnd(16)} ${String(row.source).padStart(5)} → ${String(
                row.target
              ).padStart(5)}   ${row.delta > 0 ? "+" : ""}${row.delta}`
            );
            if (row.status !== "match") failed = true;
          }

          const drift = residual(rows, a.total, b.total);
          console.log(
            `\n  page total ${a.total} → ${b.total} (${drift.total > 0 ? "+" : ""}${drift.total}), ` +
              `${drift.unaccounted > 0 ? "+" : ""}${drift.unaccounted} outside the sections above`
          );
          if (rows.some((row) => row.status === "missing")) {
            console.log(
              "\n  A missing id is only a fault on a page ported section-by-section, where\n" +
                "  the components keep the source's ids — there it means a bespoke block was\n" +
                "  flattened onto a generic component. On a cluster-mapped page the ids are\n" +
                "  the template's own, so expect these and read the heights instead."
            );
          }
        }
      }

      // --- Section surfaces -------------------------------------------------
      // The heights above are blind to decoration. `mig content` reads a source
      // section's rule for the props it knows and drops the rest of it, so a
      // rule like `.block:nth-of-type(even) { background-color: #f2f2f2; border:
      // 1px solid #000 }` arrives as `backgroundColor: surface` with the outline
      // gone — a 2px height change that every tolerance calls a match.
      //
      // Sections are paired by position here, not by id, because the sections
      // this catches (`div.why`, `.page-divider > .block`) carry no id and are
      // invisible to the id-keyed pass above.
      const sourceSectionSelectors = (ctx.config.segmentation.rules ?? [])
        .filter((rule) => rule.mode === "element" && rule.selector)
        .map((rule) => rule.selector);

      if (sourceSectionSelectors.length > 0 && ctx.preset.pageSectionSelectors) {
        const a = await readSurfaces(page, `${source.url}/${args.from}.html`, {
          selectors: sourceSectionSelectors,
          roots,
        });
        const b = await readSurfaces(page, `${targetBase}${targetPath}`, {
          selectors: ctx.preset.pageSectionSelectors,
          roots,
        });

        if (a.ok && b.ok) {
          const rows = compareSurfaces(a.rows, b.rows, { tolerancePx: Number(args.tolerance) });
          const wrong = rows.filter((row) => row.status !== "match");

          console.log(`\nSection surfaces on /${args.from}, source vs migrated:\n`);
          if (rows.length === 0) {
            console.log("  --   no sections resolved — nothing compared");
          } else if (wrong.length === 0) {
            console.log(`  ok   all ${rows.length} section(s) paint the same`);
          } else {
            for (const row of wrong) {
              if (row.status === "unpaired-source") {
                console.log(`  --   [${row.index}] ${row.label} has no migrated counterpart`);
                continue;
              }
              if (row.status === "unpaired-target") {
                console.log(`  --   [${row.index}] ${row.label} has no source counterpart`);
                continue;
              }
              console.log(`  --   [${row.index}] ${row.label}  →  ${row.targetLabel}`);
              for (const diff of row.differs) {
                console.log(`         ${diff.key.padEnd(15)} ${diff.source}  →  ${diff.target}`);
              }
            }
            console.log(
              "\n  A `height` row on a section with no id is what the pass above cannot\n" +
                "  see: an id-less source section mapped onto a template component that\n" +
                "  renders nothing like it. Rebuild it from the source's own markup and\n" +
                "  CSS in the component, keeping the props the content already uses.\n" +
                "\n  A `border`, `radius` or `shadow` row is decoration that was on the same\n" +
                "  source rule as the background and did not survive being read as a\n" +
                "  `backgroundColor` prop. Restate it in the component, keyed off the class\n" +
                "  the prop renders (`.cta-split.bg-surface`), so it follows the prop.\n" +
                "\n  A `background` row is usually the tint landing on the nearest neutral\n" +
                "  ramp stop instead of the source's own hex. Decide once whether the ramp\n" +
                "  should carry the source value — it is shared with the rest of the\n" +
                "  template — or whether this section should stop using the token.\n" +
                "\n  Unpaired rows mean the two sides disagree on how many sections the page\n" +
                "  has; positional pairing makes every row after the first one unreliable."
            );
            failed = true;
          }
        }
      }

      // --- Heading typography ---------------------------------------------
      // Boxes cannot catch this one. A heading that took the template's type
      // instead of the source's keeps its text, keeps its place, and — when it
      // is one line — keeps a height inside the geometry tolerance above. It is
      // the fault that has most often reached a built page here.
      const sourceHeadings = await readHeadings(page, `${source.url}/${args.from}.html`, { roots });
      const targetHeadings = await readHeadings(page, `${targetBase}${targetPath}`, { roots });

      if (sourceHeadings.ok && targetHeadings.ok) {
        const rows = compareHeadings(sourceHeadings.headings, targetHeadings.headings);
        const wrong = rows.filter((row) => row.status !== "match");

        console.log(`\nHeading typography on /${args.from}, source vs migrated:\n`);
        if (rows.length === 0) {
          console.log("  --   no headings paired by text — nothing compared");
        } else if (wrong.length === 0) {
          console.log(`  ok   all ${rows.length} heading(s) match the source's type`);
        } else {
          for (const row of wrong) {
            console.log(`  --   "${row.text}"  (${row.sourceTag} → ${row.targetTag})`);
            for (const diff of row.differences) {
              console.log(`         ${diff.prop.padEnd(14)} ${diff.source}  →  ${diff.target}`);
            }
            for (const accent of row.addedAccents) {
              console.log(`         highlight      none  →  ${accent}`);
            }
          }
          console.log(
            "\n  Type differences mean the heading is rendering on the template's own\n" +
              "  size ramp rather than the source's rule. Restate the source's rule in\n" +
              "  `source-bridge`, scoped under the section's class so it also clears any\n" +
              "  unlayered utility of the same shape.\n" +
              "\n  A `highlight` row is a word painted a different colour than the rest of\n" +
              "  the heading where the source paints the whole phrase alike — the\n" +
              "  starter's `.color` span convention arriving via the component's default\n" +
              "  heading value. That one is fixed in the content, not the CSS: take the\n" +
              "  span out of the heading string, and out of the structure default that\n" +
              "  keeps re-adding it to every new instance."
          );
          failed = true;
        }
      }

      // --- Broken image assets ---------------------------------------------
      // Silent on every other pass: geometry, surfaces and headings all read
      // the DOM as laid out, and a broken `<img>` still occupies its box.
      const brokenAssets = await findBrokenImages(page, `${targetBase}${targetPath}`);
      console.log(`\nImage assets on /${args.from}:\n`);
      if (!brokenAssets.ok) {
        console.log(`  --   ${brokenAssets.reason}`);
        failed = true;
      } else if (brokenAssets.broken.length === 0) {
        console.log("  ok   every <img> loaded");
      } else {
        for (const img of brokenAssets.broken) {
          console.log(`  --   ${img.src}${img.alt ? `  (alt: ${img.alt})` : ""}`);
        }
        console.log(
          "\n  A broken image almost always means its file never made it into\n" +
            "  public/ — `mig content` only copies what the content it is handed\n" +
            "  references, so a path added or corrected by hand afterward needs\n" +
            "  either a re-run of `mig content` or the file copied over by hand\n" +
            "  from the source mirror."
        );
        failed = true;
      }

      // --- Image scale -------------------------------------------------------
      // A loaded image drawn at the wrong size. The template's `<img>` rule is
      // `width: 100%`, written for art-directed photography that fills its
      // slot; a source of this vintage drops the file into a centred container
      // with no width rule and lets it draw at its own dimensions. Inside a
      // carousel slide or a fixed-ratio card nothing above sees the change.
      const sourceBoxes = await readImageBoxes(page, `${source.url}/${args.from}.html`, { roots });
      const targetBoxes = await readImageBoxes(page, `${targetBase}${targetPath}`, { roots });

      if (sourceBoxes.ok && targetBoxes.ok) {
        const resized = compareImageBoxes(sourceBoxes.images, targetBoxes.images, {
          tolerancePx: Number(args.tolerance),
        });

        console.log(`\nImage scale on /${args.from}, source vs migrated:\n`);
        if (targetBoxes.images.length === 0) {
          console.log("  --   no images paired by filename — nothing compared");
        } else if (resized.length === 0) {
          console.log("  ok   every paired image draws at the source's size");
        } else {
          for (const img of resized) {
            const flag = img.upscaled ? `  upscaled past ${img.intrinsic}px of detail` : "";
            console.log(
              `  --   ${img.name}  ${img.source}  →  ${img.target} ` +
                `(${img.delta > 0 ? "+" : ""}${img.delta})${flag}`
            );
          }
          console.log(
            "\n  An `upscaled` row is unambiguous — the photo is being drawn wider than\n" +
              "  the pixels it has, so it is visibly soft. Cap the image at its intrinsic\n" +
              "  size in the component (`width: auto; max-width: 100%`) and centre it, the\n" +
              "  way the source's own container does.\n" +
              "\n  A row without it still means the port changed the crop: the same file\n" +
              "  filling a different box shows a different part of the picture at every\n" +
              "  breakpoint than the source did."
          );
          failed = true;
        }
      }

      // --- Carousel controls -------------------------------------------------
      // `mig behaviors` carries the source slider's *options* across, never its
      // furniture — the arrows and dots are the library's, restyled by the
      // source's own stylesheet, and the port swaps one library's defaults for
      // another's. Too small for the section passes, no text for the heading
      // pass, and usually absolutely positioned so no height moves either.
      const sourceControls = await readControls(page, `${source.url}/${args.from}.html`, { roots });
      const targetControls = await readControls(page, `${targetBase}${targetPath}`, { roots });

      if (sourceControls.ok && targetControls.ok && hasControls(sourceControls, targetControls)) {
        const rows = compareControls(sourceControls, targetControls);

        console.log(`\nCarousel controls on /${args.from}, source vs migrated:\n`);
        if (rows.length === 0) {
          console.log("  ok   arrows and pager match the source");
        } else {
          for (const row of rows) {
            if (row.missing === "target") {
              console.log(`  --   ${row.label} is in the source and not on the migrated page`);
              continue;
            }
            if (row.missing === "source") {
              console.log(`  --   ${row.label} is on the migrated page and not in the source`);
              continue;
            }
            console.log(`  --   ${row.label}`);
            for (const diff of row.differs) {
              console.log(`         ${diff.key.padEnd(12)} ${diff.source}  →  ${diff.target}`);
            }
          }
          console.log(
            "\n  Control chrome is not in the options object `mig behaviors` reads, so\n" +
              "  none of it crosses on its own. Port the source's arrow and dot rules\n" +
              "  into the section component, scoped under its class, and pass the\n" +
              "  source's own arrow glyph through the carousel's arrow slots.\n" +
              "\n  A `count` row means the two sides disagree on how many slides there\n" +
              "  are, which is a content fault rather than a styling one.\n" +
              "\n  A missing pager where the source has one is usually the section's own\n" +
              "  slide-number option hiding the indicators — check the props before\n" +
              "  reaching for CSS."
          );
          failed = true;
        }
      }

      // --- Content props (whole site, no build) ------------------------------
      // The only pass here that is not a two-page comparison. Both faults it
      // finds are written into the frontmatter itself and reproduce on every
      // page sharing a section pattern, so checking only the page under
      // comparison would miss most instances of what it does find.
      const propAudit = auditContentProps({
        contentDir: ctx.paths.content,
        componentsDir: ctx.paths.components,
      });

      console.log(`\nContent props across ${propAudit.pages} page(s):\n`);
      if (
        propAudit.borrowedIds.length === 0 &&
        propAudit.selfBackgrounds.length === 0 &&
        propAudit.scaffoldingGaps.length === 0
      ) {
        console.log(
          "  ok   no borrowed section ids, no self-referencing backgrounds, " +
            "no missing CloudCannon scaffolding"
        );
      } else {
        for (const finding of propAudit.borrowedIds) {
          console.log(
            `  --   ${path.relative(ctx.paths.targetRoot, finding.file)}: ` +
              `id "${finding.id}" set on ${finding.usedBy}`
          );
          for (const owner of finding.ownedBy) {
            console.log(
              `         styles for #${finding.id} live in ` +
                `${path.relative(ctx.paths.targetRoot, owner)}`
            );
          }
        }
        for (const finding of propAudit.selfBackgrounds) {
          console.log(
            `  --   ${path.relative(ctx.paths.targetRoot, finding.file)}: ` +
              `${finding.component} uses its own content image as a background ` +
              `(${finding.image})`
          );
        }
        for (const finding of propAudit.scaffoldingGaps) {
          const where = path.relative(ctx.paths.targetRoot, finding.file);
          if (finding.missing) {
            console.log(
              `  --   ${where}: ${finding.component} is missing ${finding.missing.join(", ")}`
            );
          } else {
            console.log(
              `  --   ${where}: ${finding.component}.${finding.untypedImageProp} ` +
                `looks like an image path (${finding.value}) but is declared ` +
                `${finding.declaredType}, not type: image`
            );
          }
        }
        console.log(
          "\n  A borrowed id means a cluster was mapped onto a generic library\n" +
            "  component while a hand-ported component for that very section already\n" +
            "  exists — the id came across, the CSS scoped under it did not, and the\n" +
            "  section silently renders in the template's own look. Point that\n" +
            "  cluster at the ported component in component-map.yml and re-run\n" +
            "  `mig content`.\n" +
            "\n  A self-referencing background is a section painted with one of the\n" +
            "  images it already displays. Clear `backgroundImage.source`; if the\n" +
            "  source section really had a background, it was a colour.\n" +
            "\n  Missing scaffolding or an untyped image prop both build and render\n" +
            "  fine — only the CMS editing experience is broken. Add the missing\n" +
            "  `.cloudcannon.inputs.yml` / `.cloudcannon.structure-value.yml` /\n" +
            "  `.cloudcannon.snippets.yml` trio (see `.cloudcannon/scripts/new-component.js`),\n" +
            "  or set `type: image` on the flagged prop."
        );
        failed = true;
      }
    } finally {
      await browser.close();
      source.server.close();
      target?.server.close();
    }

    if (failed) process.exitCode = 1;
  },
});

const detect = defineCommand({
  meta: {
    name: "detect",
    description: "Fill in the chrome and section selectors by inspecting the source",
  },
  args: {
    ...sharedArgs,
    from: { type: "string", description: "Page to inspect first", default: "index" },
    "max-pages": { type: "string", description: "How many pages to sample (all by default)", default: "0" },
    "report-only": { type: "boolean", description: "Show what was found, change nothing" },
  },
  async run({ args }) {
    const ctx = await ctxFor(args);
    const { chromium } = await import("playwright");
    const { serve } = await import("../src/mirror/serve.mjs");
    const { gotoStable } = await import("../src/browser/load.mjs");
    const { DETECT_SECTION_ROOTS, DETECT_CHROME } = await import("../src/config/detect.mjs");
    const YAML = (await import("yaml")).default;

    const mirrorDir = path.join(ctx.paths.artifacts, "instrumented");
    if (!fs.existsSync(mirrorDir)) throw new Error("No mirror found. Run `mig mirror` first.");

    const { pages } = JSON.parse(
      fs.readFileSync(path.join(ctx.paths.artifacts, "pages.json"), "utf8")
    );

    const { server, url } = await serve(mirrorDir, 0);
    const browser = await chromium.launch();
    let chromeEls;
    let sampledCount = 0;
    const rootsByPage = {};

    try {
      const page = await browser.newPage({
        viewport: { width: ctx.config.segmentation.viewport, height: 1000 },
      });

      // Sample widely. A site is not one template: alongside the standard
      // interior page there are office tours, galleries, service grids, contact
      // pages and one-off profile layouts, each with its own container. Looking
      // at a couple of pages finds a couple of them and silently drops the rest.
      // Every page by default. A site's layouts are not discoverable from a
      // sample: the one gallery or profile page is exactly the one a sample
      // misses, and a missed layout migrates as an empty page.
      const requested = Number(args["max-pages"]);
      const limit = requested > 0 ? requested : pages.length;
      const home = pages.find((p) => p.id === args.from) ?? pages[0];
      const rest = pages.filter((p) => p.id !== home.id);
      const step = Math.max(1, Math.floor(rest.length / Math.max(1, limit - 1)));
      const sample = [home, ...rest.filter((_, i) => i % step === 0)].slice(0, limit);

      for (const p of sample) {
        await gotoStable(page, url + "/" + p.id + ".html", { primeLazyLoad: true, reveal: true });
        if (!chromeEls) chromeEls = await page.evaluate("(" + DETECT_CHROME + ")()");
        const chromeList = JSON.stringify(Object.values(chromeEls ?? {}).filter(Boolean));
        rootsByPage[p.id] = await page.evaluate(
          "(" + DETECT_SECTION_ROOTS + ")(" + chromeList + ")"
        );
      }
      sampledCount = sample.length;
      await page.close();
    } finally {
      await browser.close();
      server.close();
    }

    console.log(
      "Chrome:  header " + (chromeEls?.header ?? "not found") +
        "   footer " + (chromeEls?.footer ?? "not found")
    );
    // One selector per distinct container, with the pages it accounts for.
    const byselector = new Map();
    const uncovered = [];

    for (const [pageId, candidates] of Object.entries(rootsByPage)) {
      const best = candidates[0];
      if (!best) {
        uncovered.push(pageId);
        continue;
      }
      if (!byselector.has(best.childSelector)) {
        byselector.set(best.childSelector, { pages: [], children: best.children, score: best.score });
      }
      byselector.get(best.childSelector).pages.push(pageId);
    }

    const ordered = [...byselector.entries()].sort((a, b) => b[1].pages.length - a[1].pages.length);

    console.log(`\nSection containers found across ${sampledCount} sampled page(s):`);
    for (const [selector, info] of ordered) {
      const examples = info.pages.slice(0, 3).join(", ");
      const more = info.pages.length > 3 ? ` +${info.pages.length - 3} more` : "";
      console.log(
        "  " + selector.padEnd(34) + String(info.pages.length).padStart(3) + " page(s)  " +
          examples + more
      );
    }

    if (uncovered.length) {
      console.warn(
        `\n! No container found on ${uncovered.length} page(s): ${uncovered.slice(0, 6).join(", ")}` +
          `\n  These will migrate empty. Add a rule for them by hand.`
      );
    }

    const rules = ordered.map(([selector], i) => ({
      id: "sections-" + (i + 1),
      mode: "element",
      selector,
    }));

    if (args["report-only"]) {
      console.log("\nreport-only — config unchanged.");
      return;
    }

    const doc = YAML.parse(fs.readFileSync(ctx.paths.configFile, "utf8"));
    doc.segmentation = doc.segmentation ?? {};
    if (chromeEls?.header || chromeEls?.footer) {
      doc.segmentation.chrome = {
        ...(chromeEls.header ? { header: chromeEls.header } : {}),
        ...(chromeEls.footer ? { footer: chromeEls.footer } : {}),
      };
    }
    if (rules.length) doc.segmentation.rules = rules;

    if (!ctx.writer.dryRun) {
      fs.writeFileSync(ctx.paths.configFile, YAML.stringify(doc, { lineWidth: 0 }), "utf8");
    }
    console.log(
      "\nWrote " + rules.length + " segmentation rule(s) into " +
        path.basename(ctx.paths.configFile) + ".\nReview them, then run `mig scan`."
    );
  },
});

const doctor = defineCommand({
  meta: { name: "doctor", description: "Check everything the pipeline needs before running it" },
  args: sharedArgs,
  async run({ args }) {
    const ctx = await ctxFor(args);
    const { runDoctor, templateHazards } = await import("../src/config/doctor.mjs");

    const results = await runDoctor(ctx);
    let failed = 0;

    for (const r of results) {
      const mark = r.ok ? (r.warn ? "  ~ " : "  ok") : "  ! ";
      console.log(`${mark} ${r.name.padEnd(20)} ${r.detail}`);
      if (!r.ok) failed++;
    }

    console.log("");
    if (failed) {
      console.error(`${failed} check(s) need attention before the pipeline will work.`);
      process.exitCode = 1;
    } else {
      for (const h of templateHazards(ctx.paths.targetRoot)) {
        console.log(`  ${h.level === "warn" ? "!" : "-"}  ${h.label.padEnd(20)} ${h.detail}`);
      }

      console.log("Ready. Next: mig mirror -> detect -> tokens -> scan -> chrome -> content");
    }
  },
});

const status = defineCommand({
  meta: { name: "status", description: "Report which files are generated, edited, or frozen" },
  args: sharedArgs,
  async run({ args }) {
    const ctx = await ctxFor(args);
    const { reportStatus } = await import("../src/fs/status.mjs");
    reportStatus(ctx);
  },
});

const freeze = defineCommand({
  meta: {
    name: "freeze",
    description: "Claim files by hand; the toolkit stops regenerating them",
  },
  args: {
    ...sharedArgs,
    pattern: { type: "positional", description: "Path or directory relative to the target root" },
    undo: { type: "boolean", description: "Unfreeze instead" },
  },
  async run({ args }) {
    const ctx = await ctxFor(args);
    const target = path.resolve(ctx.paths.targetRoot, args.pattern);
    if (!fs.existsSync(target)) throw new Error(`No such path: ${args.pattern}`);

    const files = fs.statSync(target).isDirectory()
      ? fs
          .readdirSync(target, { recursive: true })
          .map((f) => path.join(target, f))
      : [target];

    let n = 0;
    for (const f of files) {
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) continue;
      const content = fs.readFileSync(f, "utf8");
      const next = setFrozen(f, content, !args.undo);
      if (next && next !== content) {
        fs.writeFileSync(f, next, "utf8");
        n++;
      }
    }
    console.log(`${args.undo ? "Unfroze" : "Froze"} ${n} file(s).`);
  },
});

const main = defineCommand({
  meta: {
    name: "mig",
    version: VERSION,
    description: "Fidelity-first static site -> CloudCannon Astro migration",
  },
  subCommands: {
    init, doctor, mirror, serve: serveCmd, detect, tokens, behaviors, scan, chrome, content,
    links, redirects, qa, status, freeze,
  },
});

runMain(main);

export { reportWrites };
