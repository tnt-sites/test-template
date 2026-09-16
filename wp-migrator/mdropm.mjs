import { chromium } from "playwright";
const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await c.newPage();
await p.goto("https://www.ultimatesmiles.com/", { waitUntil: "networkidle", timeout: 60000 });
await p.waitForTimeout(1500);
await p.locator('a:has-text("Dental Services")').first().hover();
await p.waitForTimeout(1200);
console.log(JSON.stringify(await p.evaluate(() => {
  const g = (sel) => { const e = document.querySelector(sel); if (!e) return null;
    const b = e.getBoundingClientRect(); const s = getComputedStyle(e);
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height),
      bg: s.backgroundColor, color: s.color, fs: s.fontSize, fw: s.fontWeight, pad: s.padding,
      cols: s.columnCount, display: s.display, td: s.textDecorationLine }; };
  const out = {};
  // find the open panel
  const panels = Array.from(document.querySelectorAll("ul,div")).filter((e) => {
    const s = getComputedStyle(e); const b = e.getBoundingClientRect();
    return b.width > 900 && b.height > 200 && b.y > 90 && b.y < 200 &&
      s.backgroundColor.includes("rgb") && s.backgroundColor !== "rgba(0, 0, 0, 0)";
  }).slice(0, 3);
  out.panels = panels.map((e) => ({ cls: e.className.slice(0,80), tag: e.tagName,
    ...(() => { const b = e.getBoundingClientRect(); const s = getComputedStyle(e);
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height),
        bg: s.backgroundColor, cols: s.columnCount, pad: s.padding }; })() }));
  for (const sel of ['.sub-menu', '.dropdown-content', '.mega-menu', 'nav .active',
    'li.menu-item-has-children.hover > a']) out[sel] = g(sel);
  // heading + first link inside panel
  if (panels[0]) {
    const h = panels[0].querySelector("h2,h3,h4,.menu-title,li:first-child a");
    const a = panels[0].querySelectorAll("a")[1];
    const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); const s = getComputedStyle(e);
      return { text: e.textContent.trim().slice(0,40), x: Math.round(b.x), y: Math.round(b.y),
        w: Math.round(b.width), fs: s.fontSize, fw: s.fontWeight, color: s.color }; };
    out.panelHeading = r(h); out.panelLink = r(a);
    out.panelLinkCount = panels[0].querySelectorAll("a").length;
  }
  return out;
}), null, 1));
await b.close();
