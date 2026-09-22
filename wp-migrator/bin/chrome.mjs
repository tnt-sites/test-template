/**
 * `wpmig dev-chrome` — reconstruct the site chrome: its content *and* its
 * appearance.
 *
 * Chrome was the one region the pipeline extracted but never compared. It came
 * across as data — menus, links, phone numbers — and was then rendered in the
 * target template's own design, so the header and footer that appear on every
 * page of the migrated site were the only parts of it that never had to look
 * like the original. This command is the missing half: alongside the data, it
 * measures how the source *presented* that chrome and writes the measurements
 * out as a token layer the target's header and footer consume.
 *
 * It is a pass of its own rather than more of `dev-extract` because chrome
 * changes for its own reasons — a new menu item, a new phone number, a
 * redesigned footer — and re-running the whole colour/type/SEO extraction to
 * pick up a menu change means re-deriving the palette from a site that has not
 * changed colour.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineCommand } from "citty";
import { chromium } from "playwright";
import { serve } from "../src/mirror/serve.mjs";
import { gotoStable } from "../src/browser/load.mjs";
import { extractChrome } from "../src/chrome/extract.mjs";
import { measureChrome, measureChromeAcross } from "../src/chrome/styles.mjs";
import { emitChromeCss } from "../src/chrome/css-emit.mjs";
import { reconcilePhones } from "../src/chrome/phones.mjs";
import { auditChromeData } from "../src/chrome/audit.mjs";
import { reconcileFonts } from "../src/chrome/fonts.mjs";
import { TARGET_ROLES, compareChrome, formatChromeReport } from "../src/chrome/compare.mjs";
import {
  buildNavData,
  buildFooterData,
  buildSiteInfo,
  collectChromeAssets,
  countNav,
} from "../src/chrome/build.mjs";
import { Writer } from "../src/fs/write.mjs";
import { patchJson, wireChromeImport } from "../src/css/tokens/wire.mjs";
import { loadIconSet } from "../src/generate/icon-map.mjs";
import { loadRouteMap } from "../src/snapshot/routes.mjs";
import { useRouteMap } from "../src/generate/props.mjs";

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const CHROME_SELECTORS = {
  header: 'header, [role="banner"], #masthead, .site-header, #header, .header, .main-header',
  footer: 'footer, [role="contentinfo"], #colophon, .site-footer, #footer',
};
const BUTTON_CLASS_PATTERN = "^(btn|button)(-\\w+)?$";

const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {});

const BANNER = `/*
 * Site chrome, measured from the source render by \`wpmig dev-chrome\`.
 *
 * Generated — edit the source site or the migrator, not this file.
 *
 * These are the *source's* values, not the target's design decisions. The
 * header and footer components read them with their own fallbacks, so a token
 * that is absent here (because the source had no such element) leaves the
 * component's own styling in place rather than blanking it.
 */`;

export const devChrome = defineCommand({
  meta: {
    name: "dev-chrome",
    description: "Rebuild the header and footer from the source: nav/footer data plus measured chrome styling.",
  },
  args: {
    page: { type: "string", description: "Snapshot page to read the chrome from", default: "index.html" },
    static: { type: "string", description: "Snapshot directory", default: path.join(HERE, ".wpmig/static") },
    target: { type: "string", description: "Target repo root", default: path.join(HERE, "..") },
    breakpoints: { type: "string", description: "Comma-separated capture widths", default: "390,768,992,1440" },
    styles: { type: "string", description: "Where to write the chrome token layer", default: "src/styles/_chrome.pcss" },
    compare: { type: "boolean", description: "Also measure the built site and report the chrome deltas", default: false },
    dist: { type: "string", description: "Built site directory, for --compare", default: path.join(HERE, "../dist") },
    "skip-data": { type: "boolean", description: "Measure styling only; leave the data files alone", default: false },
    write: { type: "boolean", description: "Actually write (default is a dry run)", default: false },
  },

  async run({ args }) {
    const staticDir = path.resolve(args.static);
    const targetRoot = path.resolve(args.target);
    if (!fs.existsSync(staticDir)) throw new Error(`snapshot dir not found: ${staticDir}`);

    const breakpoints = args.breakpoints.split(",").map(Number).filter(Boolean).sort((a, b) => a - b);
    const dryRun = !args.write;
    useRouteMap(loadRouteMap(staticDir));

    const writer = new Writer({
      targetRoot,
      artifactsDir: path.join(targetRoot, ".migration"),
      dryRun,
      version: "0.1.0",
    });

    const { server, url } = await serve(staticDir, 0);
    const browser = await chromium.launch();

    try {
      const page = await browser.newPage({ viewport: { width: breakpoints.at(-1), height: 1000 } });
      const pageUrl = `${url}/${args.page}`;

      const goto = async (target) => {
        const state = await gotoStable(target, pageUrl, { primeLazyLoad: true, reveal: true, freezeMotion: true });
        if (!state.ok) throw new Error(`could not load ${pageUrl}: ${state.reason}`);
      };
      await goto(page);

      // ---- content -------------------------------------------------------
      const extracted = await extractChrome(page, {
        chrome: CHROME_SELECTORS,
        buttonClassPattern: BUTTON_CLASS_PATTERN,
      });
      if (!extracted.header && !extracted.footer) throw new Error(`no header or footer found on ${args.page}`);

      /*
       * Undo any call-tracking substitution before anything downstream sees
       * it. Done here rather than inside `extractChrome` because the check
       * needs the pre-JS bytes, which only exist outside the browser.
       */
      const rawHtml = fs.readFileSync(path.join(staticDir, args.page), "utf8");
      const phones = reconcilePhones(extracted, rawHtml);
      if (phones.swapped.length) {
        console.log(
          `\n! call-tracking numbers replaced with the markup's own (${phones.markup[0].digits}):`
        );
        for (const s of phones.swapped) console.log(`    ${s.at}: ${s.from} -> ${s.to}`);
        console.log("");
      }

      // ---- appearance ----------------------------------------------------
      //
      // Re-navigating per width rather than resizing a loaded page: a theme
      // that assigns its layout classes once at load keeps the desktop bar
      // after a resize, and the mobile read then describes the desktop.
      const measured = await measureChromeAcross(page, { widths: breakpoints, goto });

      /*
       * A measured family the target never loads is a token that resolves to
       * nothing — the browser falls back and the chrome renders in the wrong
       * typeface while this command reports it measured the right one. So the
       * families are reconciled against what the target actually requests, and
       * both the substitutions and the genuinely absent families are named.
       */
      const branding = readJson(path.join(targetRoot, "src/data/branding.json"));
      const fonts = reconcileFonts(emitChromeCss(measured, { banner: BANNER }), branding);
      writer.write(args.styles, fonts.css, { gen: "wpmig-chrome" });

      /*
       * Connect the layer to the build.
       *
       * Writing the file is not the same as the site having it: the stylesheet
       * entry point has to import it, and until it does every measurement in
       * here is inert — the command reports a header and footer measured
       * against the original while the built site shows no sign of it. That is
       * the failure mode this whole pass exists to prevent, so the import is
       * part of the pass rather than a step in a runbook.
       */
      const wired = wireChromeImport(writer, targetRoot, args.styles);

      const roleCount = Object.values(measured[breakpoints.at(-1)] ?? {}).filter(Boolean).length;
      console.log(`chrome styling: ${roleCount} role(s) measured at ${breakpoints.join(", ")}px`);
      console.log(`  -> ${args.styles} (${fonts.css.split("\n").length} lines)`);
      console.log(wired.ok ? `  imported by ${wired.entry}` : `  ! ${wired.reason}`);
      for (const s of fonts.swapped) {
        console.log(`  font: "${s.from}" is not loaded here — using "${s.to}"`);
      }
      for (const family of fonts.missing) {
        console.log(`  ! font "${family}" is not loaded and has no relative in branding.json fontLinks`);
      }

      // ---- data ----------------------------------------------------------
      if (!args["skip-data"]) {
        const dataDir = "src/data";
        const iconSet = loadIconSet(targetRoot);

        const nav = buildNavData(extracted, readJson(path.join(targetRoot, dataDir, "mainNav.json")), { iconSet });
        const footer = buildFooterData(extracted, readJson(path.join(targetRoot, dataDir, "footer.json")), { iconSet });
        const site = buildSiteInfo(extracted, readJson(path.join(targetRoot, dataDir, "siteInfo.json")), { iconSet });

        const assets = collectChromeAssets(extracted, { mirrorDir: staticDir, writer, publicDir: "public" });

        patchJson(writer, targetRoot, path.join(dataDir, "mainNav.json"), nav, { replaceKeys: Object.keys(nav) });
        patchJson(writer, targetRoot, path.join(dataDir, "footer.json"), footer, { replaceKeys: Object.keys(footer) });
        patchJson(writer, targetRoot, path.join(dataDir, "siteInfo.json"), site, { replaceKeys: Object.keys(site) });

        console.log(`\nnav items: ${countNav(nav.navData)}`);
        console.log(`header top bar: ${nav.topBar ? `"${nav.topBar.label}" ${nav.topBar.phone.display}` : "—"}`);
        console.log(
          `footer columns: ${(footer.linkColumns ?? [])
            .map((c) => `${c.title || "(brand)"}[${c.links.length}]`)
            .join("  ") || "—"}`
        );

        // The footer has more headings than it has link columns, and the ones
        // that fall out are not all noise — a contact column is dropped
        // because `siteInfo` already carries it, a promotional band because it
        // is a page section. Naming them says which, so a column that should
        // have survived is visible rather than simply absent.
        const kept = new Set((footer.linkColumns ?? []).map((c) => c.title).filter(Boolean));
        const dropped = (extracted.footer?.columns ?? [])
          .map((c) => c.title)
          .filter((t) => t && !kept.has(t));
        if (dropped.length) {
          console.log(`  not link columns (rendered from other data, or page sections):`);
          for (const title of dropped) console.log(`    ${title}`);
        }
        console.log(`footer social images: ${(footer.socialImages ?? []).length}`);
        console.log(`copyright: ${footer.copyright ? `${footer.copyright.text} (${footer.copyright.links.length} links)` : "—"}`);
        console.log(`chrome assets: ${assets.copied.length} copied, ${assets.missing.length} missing`);
        if (assets.missing.length) console.log(`  missing: ${assets.missing.join(", ")}`);

        const findings = auditChromeData({ mainNav: nav, footer, siteInfo: site }, rawHtml);
        if (findings.length) {
          console.log(`\n! ${findings.length} chrome value(s) the source does not contain:`);
          for (const f of findings) console.log(`    ${f.file}.${f.path} = ${JSON.stringify(f.value)}\n      ${f.note}`);
        }
      }

      // ---- comparison ----------------------------------------------------
      //
      // Chrome is the region the pipeline had no way to check: page sections
      // are paired by generated class name, and chrome has none because the
      // target renders its own markup. The role table supplies that pairing.
      if (args.compare) {
        const distDir = path.resolve(args.dist);
        if (!fs.existsSync(distDir)) {
          console.log(`\n! --compare: no build at ${distDir} — run the site's build first`);
        } else {
          const built = await serve(distDir, 0);
          const builtPage = await browser.newPage();
          try {
            const results = {};
            for (const width of breakpoints) {
              await builtPage.setViewportSize({ width, height: 1000 });
              const state = await gotoStable(builtPage, `${built.url}/`, {
                primeLazyLoad: true, reveal: true, freezeMotion: true,
              });
              if (!state.ok) {
                console.log(`\n! --compare: could not load the built page at ${width}px: ${state.reason}`);
                continue;
              }
              const measuredBuilt = await measureChrome(builtPage, { roles: TARGET_ROLES });
              results[width] = compareChrome(measured[width], measuredBuilt);
            }
            console.log(`\n=== chrome comparison ===${formatChromeReport(results)}`);

            const reportPath = path.join(HERE, ".wpmig/compare/chrome.json");
            fs.mkdirSync(path.dirname(reportPath), { recursive: true });
            fs.writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
            console.log(`\nreport: ${path.relative(process.cwd(), reportPath)}`);
          } finally {
            await builtPage.close();
            built.server.close();
          }
        }
      }

      console.log(`\nwrites: ${JSON.stringify(writer.summary)}`);
      for (const r of writer.needsAttention) console.log(`  ! ${r.outcome} ${r.path}`);
      if (dryRun) console.log("\ndry run — pass --write to apply");
    } finally {
      await browser.close();
      server.close();
    }
  },
});
