// Review gate for the static snapshot: serve `static/` and confirm pages
// actually render — stylesheets applied, brand fonts resolved (not fallbacks),
// no horizontal overflow, and `.elementor-top-section` finding real sections.
// Run this before trusting `mig mirror`; a snapshot that renders unstyled
// produces a plausible-looking but worthless scan.
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { serve } from "../src/mirror/serve.mjs";

const dir = fileURLToPath(new URL("../static", import.meta.url));
const { server, url } = await serve(dir, 0);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const failed = [];
page.on("requestfailed", (r) => failed.push(r.url().replace(url, "")));
page.on("response", (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url().replace(url, "")}`); });

for (const p of ["index.html", "our-office.html", "meet-the-team.html"]) {
  failed.length = 0;
  await page.goto(`${url}/${p}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const info = await page.evaluate(() => {
    const b = getComputedStyle(document.body);
    const h = document.querySelector("h1,h2");
    const sections = document.querySelectorAll(".elementor-top-section");
    return {
      bodyFont: b.fontFamily, bodySize: b.fontSize, bg: b.backgroundColor,
      headingFont: h ? getComputedStyle(h).fontFamily : null,
      headingSize: h ? getComputedStyle(h).fontSize : null,
      topSections: sections.length,
      scrollW: document.documentElement.scrollWidth,
      docH: document.body.scrollHeight,
      styleSheets: document.styleSheets.length,
    };
  });
  console.log(`\n${p}`);
  console.log(`  sheets=${info.styleSheets} topSections=${info.topSections} height=${info.docH}px scrollW=${info.scrollW}`);
  console.log(`  body: ${info.bodySize} ${info.bodyFont.slice(0,40)} bg=${info.bg}`);
  console.log(`  h1/h2: ${info.headingSize} ${String(info.headingFont).slice(0,40)}`);
  if (failed.length) console.log(`  FAILED REQUESTS (${failed.length}):`, failed.slice(0,5));
}
await browser.close();
server.close();
