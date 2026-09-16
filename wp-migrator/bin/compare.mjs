import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineCommand } from "citty";
import { chromium } from "playwright";
import { serve } from "../src/mirror/serve.mjs";
import { gotoStable } from "../src/browser/load.mjs";
import { VIEWPORTS } from "../src/capture/screenshot.mjs";
import { autoSegment, sectionSelector, SEGMENT_MARK } from "../src/detect/segment.mjs";
import { captureSection } from "../src/capture/section.mjs";
import {
  MEASURE_BY_CLASS,
  diffMeasurements,
  comparePngs,
  formatReport,
} from "../src/qa/compare.mjs";

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Collect the generated class names per section from the emitted components,
 * so the comparison knows which elements to measure. The root class is the
 * component name itself; descendants use the `<initials>-` prefix.
 */
/**
 * Load the intermediate representation written at generation time. It carries
 * the only thing that makes a per-element comparison possible: which captured
 * source node became which generated class.
 */
function loadIr(slug) {
  const file = path.join(HERE, ".wpmig/ir", `${slug || "index"}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`no IR at ${file} — run \`wpmig dev-page ${slug}.html\` first`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** Measure marked source nodes in the browser, keyed by capture-marker index. */
function MEASURE_BY_MARK({ mark, ns }) {
  const out = {};
  for (const { n, cls } of ns) {
    const el = document.querySelector(`[${mark}="${n}"]`);
    if (!el) {
      out[cls] = null;
      continue;
    }
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    out[cls] = {
      x: Math.round(r.x),
      y: Math.round(r.y + window.scrollY),
      width: Math.round(r.width),
      height: Math.round(r.height),
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing,
      fontFamily: cs.fontFamily,
      textAlign: cs.textAlign,
      color: cs.color,
      backgroundColor: cs.backgroundColor,
      display: cs.display,
      flexDirection: cs.flexDirection,
      justifyContent: cs.justifyContent,
      alignItems: cs.alignItems,
      visible: cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0,
    };
  }
  return out;
}

async function measure(page, url, width, classes) {
  await page.setViewportSize({ width, height: 900 });
  const state = await gotoStable(page, url, {
    primeLazyLoad: true,
    reveal: true,
    freezeMotion: true,
  });
  if (!state.ok) return null;
  await page.evaluate(() => {
    const vw = window.innerWidth,
      vh = window.innerHeight;
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      if (cs.position !== "fixed" && cs.position !== "sticky") continue;
      const r = el.getBoundingClientRect();
      if (r.width * r.height > vw * vh * 0.35) el.style.setProperty("display", "none", "important");
    }
  });
  await page.waitForTimeout(250);
  return page.evaluate(MEASURE_BY_CLASS, classes);
}

/**
 * One full comparison pass, returning the report. Exported so the refine loop
 * can drive it in-process rather than shelling out and parsing stdout.
 */
export async function runCompare(opts) {
  const {
    page: pageFile,
    route: routeArg,
    static: staticArg,
    dist: distArg,
    viewports: viewportsArg,
    shots = true,
    quiet = false,
  } = opts;
  const slug = pageFile.replace(/\.html?$/, "");
  const staticDir = path.resolve(staticArg);
  const distDir = path.resolve(distArg);
  if (!fs.existsSync(distDir)) throw new Error(`no build at ${distDir}`);

  const ir = loadIr(slug);
  // The built route is the page's source URL, not its flat snapshot filename —
  // for a nested page those differ, and using the filename requests a URL the
  // build never produced.
  const route = routeArg ?? (ir.route ?? "/").replace(/^\/|\/$/g, "");
  const sections = ir.sections;
  const allClasses = [...new Set(sections.flatMap((sec) => sec.nodeMap.map((nm) => nm.cls)))];
  const outDir = path.join(HERE, ".wpmig/compare", slug);
  fs.mkdirSync(outDir, { recursive: true });

  const srcSrv = await serve(staticDir, 0);
  const bltSrv = await serve(distDir, 0);
  const browser = await chromium.launch();
  const report = { page: slug, generatedAt: new Date().toISOString(), viewports: {}, summary: {} };
  const failures = [];

  try {
    const sp = await browser.newPage();
    const bp = await browser.newPage();
    const srcUrl = `${srcSrv.url}/${pageFile}`;
    const bltUrl = `${bltSrv.url}/${route ? `${route}/` : ""}`;

    for (const width of viewportsArg) {
      const bltM = await measure(bp, bltUrl, width, allClasses);
      const srcM = await measureSource(sp, srcUrl, width, sections);
      if (!srcM || !bltM) {
        // Never swallowed: a page that could not be loaded produces no
        // findings and no pixel diff, which is indistinguishable from a
        // perfect match. The refine loop reads that as "under threshold" and
        // declares the page done.
        failures.push(`${width}px: could not load ${!bltM ? bltUrl : srcUrl}`);
        continue;
      }
      const perSection = [];
      for (const section of sections) {
        const classes = section.nodeMap.map((nm) => nm.cls);
        const pick = (m) => Object.fromEntries(classes.map((c) => [c, m[c] ?? null]));
        const findings = diffMeasurements(pick(srcM), pick(bltM), { rootClass: section.rootClass });
        let pixel = null;
        if (shots) {
          pixel = await shootAndDiff(
            sp,
            bp,
            srcUrl,
            bltUrl,
            sectionSelector(section.sectionIndex),
            `.${section.rootClass}`,
            section.rootClass,
            width,
            outDir
          );
        }
        perSection.push({ id: section.id, findings, pixel });
      }
      report.viewports[width] = perSection;
      if (!quiet) {
        console.log(`\n──────── ${width}px ────────`);
        for (const s of perSection) {
          if (!s.findings.length && (!s.pixel || s.pixel.ratio < 0.02)) continue;
          console.log(formatReport(s.id, width, s.findings, s.pixel));
        }
      }
    }

    if (!Object.keys(report.viewports).length) {
      throw new Error(
        `nothing could be measured for ${pageFile} — ${failures.join("; ") || "no viewports produced measurements"}`
      );
    }

    const worst = [];
    for (const [width, secs] of Object.entries(report.viewports)) {
      for (const s of secs) {
        worst.push({
          width: Number(width),
          id: s.id,
          findings: s.findings.length,
          missing: s.findings.filter((f) => f.kind === "missing" || f.kind === "not-rendered")
            .length,
          pixel: s.pixel ? Number((s.pixel.ratio * 100).toFixed(2)) : null,
        });
      }
    }
    worst.sort((a, b) => (b.pixel ?? 0) - (a.pixel ?? 0) || b.findings - a.findings);
    const scored = worst.filter((w) => w.pixel != null);
    report.summary.worst = worst.slice(0, 20);
    report.summary.totalFindings = worst.reduce((a, w) => a + w.findings, 0);
    // No screenshots means no pixel measurement — which is not the same as a
    // perfect score. Reporting 0 there let a run with screenshots disabled
    // average in as "0% mismatch" and claim a fidelity it never measured.
    report.summary.meanPixel = scored.length
      ? Number((scored.reduce((a, w) => a + w.pixel, 0) / scored.length).toFixed(2))
      : null;
    fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
    return report;
  } finally {
    await browser.close();
    srcSrv.server.close();
    bltSrv.server.close();
  }
}

export const devCompare = defineCommand({
  meta: {
    name: "dev-compare",
    description: "Visually validate the built Astro page against the rendered WordPress page.",
  },
  args: {
    page: {
      type: "positional",
      description: "Source page file (e.g. full-partial-mouth-rehabilitation.html)",
      required: true,
    },
    route: { type: "string", description: "Built route (defaults to the page slug)" },
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
    shots: {
      type: "boolean",
      description: "Also write section screenshots + diff images",
      default: true,
    },
  },
  async run({ args }) {
    const slug = args.page.replace(/\.html?$/, "");
    const staticDir = path.resolve(args.static);
    const distDir = path.resolve(args.dist);
    if (!fs.existsSync(distDir))
      throw new Error(`no build at \`${distDir}\` — run \`npm run build\` first`);

    const viewports = args.viewports.split(",").map(Number);
    const ir = loadIr(slug);
    // The built route is the *source* URL, which for a nested page is not its
    // flat snapshot filename — generation records it so both sides agree.
    const route = args.route ?? (ir.route ?? "/").replace(/^\/|\/$/g, "");
    const sections = ir.sections;
    const allClasses = [...new Set(sections.flatMap((sec) => sec.nodeMap.map((nm) => nm.cls)))];
    const outDir = path.join(HERE, ".wpmig/compare", slug);
    fs.mkdirSync(outDir, { recursive: true });

    const srcSrv = await serve(staticDir, 0);
    const bltSrv = await serve(distDir, 0);
    const browser = await chromium.launch();

    const report = {
      page: slug,
      generatedAt: new Date().toISOString(),
      viewports: {},
      summary: {},
    };

    try {
      const sp = await browser.newPage();
      const bp = await browser.newPage();
      const srcUrl = `${srcSrv.url}/${args.page}`;
      const bltUrl = `${bltSrv.url}/${route ? `${route}/` : ""}`;

      for (const width of viewports) {
        // Built side: generated class names are directly addressable.
        const bltM = await measure(bp, bltUrl, width, allClasses);

        // Source side: the snapshot HTML carries no generated classes, so the
        // capture markers have to be re-stamped. Segmentation and capture are
        // deterministic for a given DOM, so re-running reproduces the same
        // node numbering the generator saw — which is what the IR keys on.
        const srcM = await measureSource(sp, srcUrl, width, sections);
        if (!srcM || !bltM) {
          console.log(`! could not measure at ${width}px`);
          continue;
        }

        const perSection = [];
        for (const section of sections) {
          const classes = section.nodeMap.map((nm) => nm.cls);
          const pick = (m) => Object.fromEntries(classes.map((c) => [c, m[c] ?? null]));
          const findings = diffMeasurements(pick(srcM), pick(bltM), {
            rootClass: section.rootClass,
          });

          let pixel = null;
          if (args.shots) {
            pixel = await shootAndDiff(
              sp,
              bp,
              srcUrl,
              bltUrl,
              sectionSelector(section.sectionIndex),
              `.${section.rootClass}`,
              section.rootClass,
              width,
              outDir
            );
          }
          perSection.push({ id: section.id, findings, pixel });
        }
        report.viewports[width] = perSection;

        console.log(`\n──────── ${width}px ────────`);
        for (const s of perSection) {
          if (!s.findings.length && (!s.pixel || s.pixel.ratio < 0.02)) continue;
          console.log(formatReport(s.id, width, s.findings, s.pixel));
        }
      }

      // Roll-up: worst offenders first, which is where to spend effort.
      const worst = [];
      for (const [width, secs] of Object.entries(report.viewports)) {
        for (const s of secs) {
          worst.push({
            width: Number(width),
            id: s.id,
            findings: s.findings.length,
            missing: s.findings.filter((f) => f.kind === "missing" || f.kind === "not-rendered")
              .length,
            pixel: s.pixel ? Number((s.pixel.ratio * 100).toFixed(2)) : null,
          });
        }
      }
      worst.sort((a, b) => (b.pixel ?? 0) - (a.pixel ?? 0) || b.findings - a.findings);
      report.summary.worst = worst.slice(0, 20);

      fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));

      console.log(`\n════════ worst sections ════════`);
      for (const w of worst.slice(0, 12)) {
        console.log(
          `  ${String(w.pixel ?? "—").padStart(6)}%  ${String(w.findings).padStart(3)} findings` +
            `${w.missing ? `  ${w.missing} MISSING` : ""}   ${w.id} @${w.width}`
        );
      }
      console.log(`\nreport: ${path.relative(process.cwd(), path.join(outDir, "report.json"))}`);
    } finally {
      await browser.close();
      srcSrv.server.close();
      bltSrv.server.close();
    }
  },
});

/**
 * Measure the source by re-running the real capture, not by re-stamping the
 * DOM by hand: `captureSection` only marks the nodes it *retains* (wrapper
 * chains are collapsed by geometry first), and its counter reflects that. A
 * naive document-order walk would produce different numbering and pair every
 * element against the wrong counterpart. Re-running is also what guarantees
 * the source side is measured by exactly the same code that generated it.
 */
async function measureSource(page, url, width, sections) {
  await page.setViewportSize({ width, height: 900 });
  const state = await gotoStable(page, url, {
    primeLazyLoad: true,
    reveal: true,
    freezeMotion: true,
  });
  if (!state.ok) return null;
  await page.evaluate(() => {
    const vw = window.innerWidth,
      vh = window.innerHeight;
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      if (cs.position !== "fixed" && cs.position !== "sticky") continue;
      const r = el.getBoundingClientRect();
      if (r.width * r.height > vw * vh * 0.35) el.style.setProperty("display", "none", "important");
    }
  });
  await autoSegment(page, { foldBelowPx: 40 });

  const out = {};
  for (const section of sections) {
    let captured;
    try {
      captured = await captureSection(page, sectionSelector(section.sectionIndex), {
        breakpoints: [width],
      });
    } catch {
      continue;
    }
    const byNode = captured.styles[width] || {};
    for (const { n, cls } of section.nodeMap) {
      const rec = byNode[n];
      if (!rec) {
        out[cls] = null;
        continue;
      }
      const st = rec.styles;
      out[cls] = {
        x: Math.round(rec.box.x),
        y: Math.round(rec.box.y),
        width: Math.round(rec.box.w),
        height: Math.round(rec.box.h),
        fontSize: st.fontSize,
        fontWeight: st.fontWeight,
        lineHeight: st.lineHeight,
        letterSpacing: st.letterSpacing,
        fontFamily: st.fontFamily,
        textAlign: st.textAlign,
        color: st.color,
        backgroundColor: st.backgroundColor,
        display: st.display,
        flexDirection: st.flexDirection,
        justifyContent: st.justifyContent,
        alignItems: st.alignItems,
        visible: rec.visible,
      };
    }
  }
  return out;
}

async function shootAndDiff(sp, bp, srcUrl, bltUrl, srcSel, bltSel, rootClass, width, outDir) {
  const shoot = async (page, url, sel, file) => {
    const el = await page.$(sel);
    if (!el) return null;
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(200);
    try {
      await el.screenshot({ path: file });
      return file;
    } catch {
      return null;
    }
  };
  const a = path.join(outDir, `${rootClass}@${width}-source.png`);
  const b = path.join(outDir, `${rootClass}@${width}-built.png`);
  const sa = await shoot(sp, srcUrl, srcSel, a);
  const sb = await shoot(bp, bltUrl, bltSel, b);
  if (!sa || !sb) return null;
  try {
    return comparePngs(a, b, path.join(outDir, `${rootClass}@${width}-diff.png`));
  } catch {
    return null;
  }
}
