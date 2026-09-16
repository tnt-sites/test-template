import { chromium } from "playwright";
const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await c.newPage();
const [url, out, scope] = process.argv.slice(2);
await p.goto(url, { waitUntil: "networkidle", timeout: 60000 });
await p.waitForTimeout(1500);
await p.evaluate(() => window.scrollTo(0, 1400));
await p.waitForTimeout(1500);
await p.screenshot({ path: `${out}/sticky.png`, clip: { x: 0, y: 0, width: 1440, height: 150 } });
const sel = scope === "live"
  ? { head: "header, .navbar-fixed, #Header", bar: ".top-bar, .header-top, .info-bar",
      addr: ".client-address, .top-bar address", call: 'a[href^="tel"]',
      book: 'a:has-text("Book Online")', nav: "nav, .nav-wrapper", logo: "header img" }
  : { head: ".main-nav", bar: ".hd-top, .hd-utility", addr: ".hd-address",
      call: '.hd-actions a[href^="tel"]', book: '.hd-actions a:not([href^="tel"])',
      nav: ".desktop-main-nav", logo: ".main-nav-logo img" };
console.log(url);
console.log(JSON.stringify(await p.evaluate((sel) => {
  const o = {};
  for (const [k, s] of Object.entries(sel)) {
    let e = null;
    try { e = document.querySelector(s); } catch { }
    if (!e) { o[k] = null; continue; }
    const b = e.getBoundingClientRect(); const st = getComputedStyle(e);
    o[k] = { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height),
      bg: st.backgroundColor, color: st.color, fs: st.fontSize, pos: st.position, pad: st.padding };
  }
  return o;
}, sel), null, 1));
await b.close();
