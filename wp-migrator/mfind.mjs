import { chromium } from "playwright";
const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await c.newPage();
await p.goto("https://www.ultimatesmiles.com/", { waitUntil: "networkidle", timeout: 60000 });
await p.waitForTimeout(1500);
await p.evaluate(() => window.scrollTo(0, 1400));
await p.waitForTimeout(1600);
console.log(JSON.stringify(await p.evaluate(() => {
  // anything pinned at the top of the viewport while scrolled
  return Array.from(document.querySelectorAll("body *")).filter((e) => {
    const s = getComputedStyle(e); const b = e.getBoundingClientRect();
    return (s.position === "fixed" || s.position === "sticky") && b.height > 20 && b.width > 600 && b.y < 140;
  }).slice(0, 12).map((e) => {
    const b = e.getBoundingClientRect(); const s = getComputedStyle(e);
    return { tag: e.tagName, id: e.id, cls: String(e.className).slice(0, 70),
      x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height),
      bg: s.backgroundColor, pos: s.position, z: s.zIndex };
  });
}), null, 1));
await b.close();
