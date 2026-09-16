import { chromium } from "playwright";
const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 1440, height: 1000 } });
const p = await c.newPage();
await p.goto("http://localhost:4324/", { waitUntil: "networkidle", timeout: 60000 });
await p.waitForTimeout(1200);
console.log(JSON.stringify(await p.evaluate(() => {
  const g = (sel) => { const e = document.querySelector(sel); if (!e) return null;
    const b = e.getBoundingClientRect(); const s = getComputedStyle(e);
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height),
      bg: s.backgroundColor, fs: s.fontSize, fw: s.fontWeight, ta: s.textAlign }; };
  const r = {};
  for (const sel of [".hero-slider", ".hs-slide.is-active .hs-panel", ".hs-title", ".hs-form-card",
    ".intro-cards", ".intro-cards .ic-inner", ".ic-intro", ".ic-heading", ".ic-video",
    ".ic-card", ".ic-card-image img", ".ic-card-title",
    ".services-grid", ".services-grid-heading", ".services-grid-items",
    ".services-grid-items > editable-array-item", ".services-grid-figure img",
    ".services-grid-title", ".location-map", ".location-map iframe"]) r[sel] = g(sel);
  return r;
}), null, 1));
await b.close();
