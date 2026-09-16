import { chromium } from "playwright";
const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await c.newPage();
const S = process.argv[2];
await p.goto("http://localhost:4324/", { waitUntil: "networkidle", timeout: 60000 });
await p.waitForTimeout(1200);
const snap = async (label, y, file) => {
  await p.evaluate((y) => window.scrollTo(0, y), y);
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${S}/${file}`, clip: { x: 0, y: 0, width: 1440, height: 160 } });
  console.log(label, JSON.stringify(await p.evaluate(() => {
    const sec = document.querySelector(".main-nav");
    const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); const s = getComputedStyle(e);
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height),
        bg: s.backgroundColor, pos: s.position }; };
    return { cls: sec ? String(sec.className).slice(0,60) : null, sec: r(sec),
      logo: r(document.querySelector(".main-nav-logo img")),
      nav: r(document.querySelector(".desktop-main-nav")),
      hdTop: r(document.querySelector(".hd-top, .hd-utility, .hd-bar")) };
  })));
};
await snap("TOP:     ", 0, "local-top.png");
await snap("SCROLLED:", 1400, "local-sticky.png");
await b.close();
