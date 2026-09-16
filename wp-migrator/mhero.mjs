import { chromium } from "playwright";
const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 1440, height: 1000 } });
const p = await c.newPage();
await p.goto("https://www.ultimatesmiles.com/", { waitUntil: "networkidle", timeout: 60000 });
await p.waitForTimeout(1500);
const out = await p.evaluate(() => {
  const r = {};
  const g = (sel) => { const e = document.querySelector(sel); if (!e) return null;
    const b = e.getBoundingClientRect(); const s = getComputedStyle(e);
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height),
      bg: s.backgroundColor, color: s.color, fs: s.fontSize, ff: s.fontFamily.split(",")[0],
      fw: s.fontWeight, pad: s.padding, mar: s.margin, ta: s.textAlign, lh: s.lineHeight }; };
  for (const sel of ["#home-slider", "#home-slider .slides", "#home-slider .slide-1 img",
    ".form-wrapper", ".form-title", ".slide-1 .snap", ".slide-title", ".caption-body",
    ".main-section", ".main-section .container", ".main-section .intro",
    ".main-section-intro-heading h1", ".main-section .profile-wrap", ".main-section .profile-image img",
    ".main-section .matchInnerHeight h3", ".main-section video",
    ".services", ".services .container", ".services h3", ".services .grid", ".services figure",
    ".services .service-image img", ".services figcaption", ".services figcaption h2",
    ".services figcaption h2 span", ".divider-dotted", ".location", ".contact-cta"]) {
    r[sel] = g(sel); }
  return r;
});
console.log(JSON.stringify(out, null, 1));
await b.close();
