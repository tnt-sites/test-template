import { chromium } from "playwright";
const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await c.newPage();
await p.goto("https://www.ultimatesmiles.com/", { waitUntil: "networkidle", timeout: 60000 });
await p.evaluate(() => window.scrollTo(0, 1400));
await p.waitForTimeout(1600);
console.log(JSON.stringify(await p.evaluate(() => {
  const nav = document.querySelector("nav.small");
  const call = nav.querySelector('a[href^="tel"]');
  const book = nav.querySelector('a[href*="schedule"], a[href*="Book"]');
  const chain = (el, n) => { const out = []; let e = el;
    for (let i = 0; i < n && e && e !== document.body; i++) {
      const s = getComputedStyle(e); const b = e.getBoundingClientRect();
      out.push({ tag: e.tagName, cls: String(e.className).slice(0,50),
        x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height),
        bg: s.backgroundColor }); e = e.parentElement; }
    return out; };
  // sample the painted pixel colours across the top strip
  return { callChain: chain(call, 4), bookChain: chain(book, 4),
    addrEl: (() => { const a = Array.from(nav.querySelectorAll("*")).find(e => /Via Centre/.test(e.textContent) && e.children.length === 0);
      if (!a) return null; const b = a.getBoundingClientRect(); const s = getComputedStyle(a);
      return { text: a.textContent.trim().slice(0,50), x: Math.round(b.x), y: Math.round(b.y),
        w: Math.round(b.width), h: Math.round(b.height), color: s.color, fs: s.fontSize,
        parentBg: getComputedStyle(a.parentElement).backgroundColor }; })() };
}), null, 1));
await b.close();
