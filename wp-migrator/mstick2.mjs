import { chromium } from "playwright";
const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await c.newPage();
await p.goto("https://www.ultimatesmiles.com/", { waitUntil: "networkidle", timeout: 60000 });
await p.waitForTimeout(1500);
const snap = async (label, y) => {
  await p.evaluate((y) => window.scrollTo(0, y), y);
  await p.waitForTimeout(1500);
  const d = await p.evaluate(() => {
    const nav = document.querySelector("nav");
    const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); const s = getComputedStyle(e);
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height),
        bg: s.backgroundColor, color: s.color, fs: s.fontSize, pad: s.padding, display: s.display }; };
    const q = (sel) => r(nav ? nav.querySelector(sel) : null);
    return { navClass: nav ? nav.className : null, nav: r(nav),
      topbar: q(".top-info, .nav-top, .header-info, .top-wrapper, .grey-bar") ||
              q("div:first-child"),
      logo: q("img"), logoWrap: q(".brand-logo, .logo, .nav-logo"),
      addr: q(".client-address") || q("address"),
      callBlock: q('a[href^="tel"]'),
      bookBlock: q('a[href*="schedule"], a[href*="Book"]'),
      navList: q("ul.hide-on-med-and-down, ul.right, ul"),
      firstNavLink: q("ul li a") };
  });
  console.log(label, JSON.stringify(d, null, 1));
};
await snap("TOP:", 0);
await snap("SCROLLED:", 1400);
await b.close();
