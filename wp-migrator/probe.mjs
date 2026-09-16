import { chromium } from "playwright";
const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await c.newPage();
await p.goto("http://localhost:4324/", { waitUntil: "networkidle", timeout: 60000 });
await p.waitForTimeout(1200);
await p.locator('.desktop-main-nav a:has-text("Dental Services")').first().hover();
await p.waitForTimeout(800);
console.log(JSON.stringify(await p.evaluate(() => {
  const panel = document.querySelector(".desktop-main-nav .nav-item.has-children:hover .nav-item-content")
    || Array.from(document.querySelectorAll(".desktop-main-nav .nav-item-content")).find(e => getComputedStyle(e).display !== "none");
  if (!panel) return "no panel";
  const chain = []; let e = panel;
  while (e && e !== document.body) {
    const s = getComputedStyle(e); const b = e.getBoundingClientRect();
    chain.push({ tag: e.tagName, cls: String(e.className).slice(0,50),
      x: Math.round(b.x), w: Math.round(b.width), overflow: s.overflow,
      maxW: s.maxWidth, pos: s.position, padL: s.paddingLeft });
    e = e.parentElement;
  }
  return chain;
}), null, 1));
await b.close();
