#!/usr/bin/env node
/**
 * Section-by-section visual + computed-style diff, source vs build.
 *
 * The migration has been checked by eye up to now — screenshot both, squint,
 * spot the difference. That missed real things repeatedly (the wood overlay was
 * layered inside out, button radius was backwards, affiliation sizing never
 * applied because a layered rule lost to an unlayered one). All of those are
 * obvious the moment the two are put side by side with their computed styles
 * printed underneath.
 *
 * `mig qa` was meant to cover this. Its pixel-diff half is dead code:
 * src/qa/shot.mjs exports captureElement/comparePngs, but bin/mig.mjs only ever
 * imports measureLayout/compareLayout. This is the missing half, standalone.
 *
 * Usage:
 *   node tools/compare.mjs                 # homepage, every section
 *   node tools/compare.mjs our-office      # one page
 *   node tools/compare.mjs index --section 3
 *   node tools/compare.mjs index --styles-only
 *
 * Writes .migration/compare/<page>-<n>.png — source left, build right.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { serve } from "../src/mirror/serve.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATIC = path.join(ROOT, "static");
const DIST = path.resolve(ROOT, "../dist");
const OUT = path.join(ROOT, ".migration/compare");

const args = process.argv.slice(2);
const pageId = args.find((a) => !a.startsWith("--")) ?? "index";
const only = args.includes("--section") ? Number(args[args.indexOf("--section") + 1]) : null;
const stylesOnly = args.includes("--styles-only");
const width = Number(args[args.indexOf("--width") + 1]) || 1280;

/** Properties worth diffing — the ones that have actually gone wrong. */
const PROPS = [
  "backgroundColor", "backgroundImage", "color", "fontFamily", "fontSize",
  "fontWeight", "fontStyle", "lineHeight", "letterSpacing", "textTransform",
  "textAlign", "borderRadius", "borderWidth", "paddingTop", "paddingBottom",
];

/** Scroll everything into view so lazy images and reveal animations settle. */
const settle = async (page) => {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    () =>
      new Promise((r) => {
        let y = 0;
        const t = setInterval(() => {
          window.scrollTo(0, (y += 700));
          if (y > document.body.scrollHeight + 700) {
            clearInterval(t);
            r();
          }
        }, 20);
      })
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
};

/**
 * The two trees name sections differently: the source uses Elementor's
 * top-section class, the build uses whatever component was emitted. Both are
 * "the page's top-level content blocks", so both are read that way.
 */
const SECTIONS = (isSource) => {
  if (isSource) {
    const H = document.querySelector('header[data-elementor-type="header"]');
    return [...document.querySelectorAll("section.elementor-top-section, div.elementor-top-section")].filter(
      (s) =>
        !H?.contains(s) &&
        !s.closest('[data-elementor-type="footer"]') &&
        !s.closest('[data-elementor-type="popup"]')
    );
  }
  const main = document.querySelector("main");
  if (!main) return [];
  // Astro's editable-array wrapper sits between main and the sections.
  const host = main.children.length === 1 && main.children[0].children.length > 1 ? main.children[0] : main;
  return [...host.children];
};

const PROBE = ([isSource, props]) => {
  const H = document.querySelector('header[data-elementor-type="header"]');
  let list;
  if (isSource) {
    list = [...document.querySelectorAll("section.elementor-top-section, div.elementor-top-section")].filter(
      (s) =>
        !H?.contains(s) &&
        !s.closest('[data-elementor-type="footer"]') &&
        !s.closest('[data-elementor-type="popup"]')
    );
  } else {
    const main = document.querySelector("main");
    const host =
      main && main.children.length === 1 && main.children[0].children.length > 1
        ? main.children[0]
        : main;
    list = host ? [...host.children] : [];
  }
  const read = (el) => {
    if (!el) return null;
    const c = getComputedStyle(el);
    const o = {};
    for (const p of props) o[p] = c[p];
    return o;
  };
  return list.map((s, i) => {
    const r = s.getBoundingClientRect();
    return {
      i,
      height: Math.round(r.height),
      text: (s.innerText || "").replace(/\s+/g, " ").trim().slice(0, 70),
      section: read(s),
      heading: read(s.querySelector("h1,h2,h3,.elementor-heading-title,.elementor-slide-heading")),
      body: read(s.querySelector("p,.elementor-slide-description,.elementor-text-editor")),
      button: read(s.querySelector(".button, .elementor-button, a[class*=button]")),
      images: s.querySelectorAll("img").length,
    };
  });
};

async function open(browser, dir, file) {
  const { server, url } = await serve(dir, 0);
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto(`${url}/${file}`, { waitUntil: "networkidle" }).catch(() => {});
  // The source ships a modal that covers the hero.
  await page.evaluate(() => {
    document.querySelectorAll('[data-elementor-type="popup"],.dialog-widget').forEach((n) => n.remove());
  });
  await settle(page);
  return { page, server };
}

const fmt = (v) => (v ?? "—").toString().replace(/^rgba?\(([^)]+)\)$/, "rgb($1)").slice(0, 34);

function diffRow(label, a, b) {
  if (!a && !b) return [];
  const rows = [];
  for (const p of PROPS) {
    const av = a?.[p];
    const bv = b?.[p];
    if (av === bv) continue;
    if (p === "backgroundImage" && (av ?? "none") === "none" && (bv ?? "none") === "none") continue;
    rows.push(`    ${p.padEnd(17)} src ${fmt(av).padEnd(36)} built ${fmt(bv)}`);
  }
  return rows.length ? [`  ${label}:`, ...rows] : [];
}

async function main() {
  if (!fs.existsSync(DIST)) throw new Error("No dist/. Run `npm run build` first.");
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();
  const src = await open(browser, STATIC, `${pageId}.html`);
  const blt = await open(browser, DIST, pageId === "index" ? "index.html" : `${pageId}/index.html`);

  const a = await src.page.evaluate(PROBE, [true, PROPS]);
  const b = await blt.page.evaluate(PROBE, [false, PROPS]);

  console.log(`\n${pageId}: ${a.length} source section(s) vs ${b.length} built\n`);

  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (only !== null && i !== only) continue;
    const s = a[i];
    const t = b[i];
    const tag = !s ? "EXTRA IN BUILD" : !t ? "MISSING IN BUILD" : "";
    console.log(
      `[${i}] ${tag}  h: ${s?.height ?? "—"} vs ${t?.height ?? "—"}   imgs: ${s?.images ?? "—"} vs ${t?.images ?? "—"}`
    );
    if (s) console.log(`    src   "${s.text}"`);
    if (t) console.log(`    built "${t.text}"`);
    if (s && t) {
      const rows = [
        ...diffRow("section", s.section, t.section),
        ...diffRow("heading", s.heading, t.heading),
        ...diffRow("body", s.body, t.body),
        ...diffRow("button", s.button, t.button),
      ];
      console.log(rows.length ? rows.join("\n") : "    (computed styles match on every tracked property)");
    }
    console.log("");

    if (stylesOnly || !s || !t) continue;

    // Side-by-side capture: shoot each section, then compose the pair in a
    // throwaway page so one file shows both.
    const shot = async (ctx, idx, isSource, file) => {
      const el = await ctx.page.evaluateHandle(
        ([fn, ii, isSrc]) => new Function("isSource", `return (${fn})(isSource)`)(isSrc)[ii],
        [SECTIONS.toString(), idx, isSource]
      );
      const box = await el.asElement()?.boundingBox();
      if (!box) return null;
      await el.asElement().scrollIntoViewIfNeeded();
      await ctx.page.waitForTimeout(250);
      await el.asElement().screenshot({ path: file });
      return file;
    };

    const fa = path.join(OUT, `.a-${i}.png`);
    const fb = path.join(OUT, `.b-${i}.png`);
    await shot(src, i, true, fa);
    await shot(blt, i, false, fb);
    if (!fs.existsSync(fa) || !fs.existsSync(fb)) continue;

    const composer = await browser.newPage({ viewport: { width: width * 2 + 60, height: 900 } });
    await composer.setContent(`
      <style>
        body{margin:0;background:#111;font:12px system-ui;display:flex;gap:20px;padding:20px}
        figure{margin:0;flex:1}
        figcaption{color:#eee;padding:6px 0}
        img{width:100%;display:block;border:1px solid #333}
      </style>
      <figure><figcaption>SOURCE — ${pageId} [${i}]</figcaption><img src="file://${fa}"></figure>
      <figure><figcaption>BUILD — ${pageId} [${i}]</figcaption><img src="file://${fb}"></figure>
    `);
    await composer.waitForTimeout(200);
    const outFile = path.join(OUT, `${pageId}-${i}.png`);
    await composer.screenshot({ path: outFile, fullPage: true });
    await composer.close();
    fs.unlinkSync(fa);
    fs.unlinkSync(fb);
    console.log(`    -> ${path.relative(process.cwd(), outFile)}\n`);
  }

  await browser.close();
  src.server.close();
  blt.server.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
