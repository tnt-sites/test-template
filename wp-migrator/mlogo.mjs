import { chromium } from "playwright";
const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await c.newPage();
await p.goto("http://localhost:4324/", { waitUntil: "networkidle", timeout: 60000 });
await p.evaluate(() => window.scrollTo(0, 1400));
await p.waitForTimeout(1200);
console.log(JSON.stringify(await p.evaluate(() => {
  const wrap = document.querySelector(".main-nav-logo");
  const img = wrap ? wrap.querySelector("img") : null;
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); const s = getComputedStyle(e);
    return { tag: e.tagName, cls: String(e.className).slice(0,50), h: Math.round(b.height),
      w: Math.round(b.width), cssH: s.height, maxH: s.maxHeight }; };
  return { wrap: r(wrap), img: r(img),
    innerTags: wrap ? Array.from(wrap.children).map(e => e.tagName + "." + String(e.className).slice(0,30)) : [] };
}), null, 1));
await b.close();
