import { chromium } from "playwright";
const URL = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(1200);
const out = await page.evaluate(() => {
  const pick = (el, label) => {
    if (!el) return [label, null];
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    return [label, { box:`${Math.round(r.width)}x${Math.round(r.height)}`,
      bg: cs.backgroundColor, color: cs.color, font: cs.fontFamily.split(",")[0],
      size: cs.fontSize, weight: cs.fontWeight, lh: cs.lineHeight,
      tt: cs.textTransform, radius: cs.borderRadius, pad: cs.paddingTop }];
  };
  const q = s => document.querySelector(s);
  return Object.fromEntries([
    pick(document.body, "body"), pick(q("h1"), "h1"), pick(q("h2"), "h2"), pick(q("h3"), "h3"),
    pick(q("p"), "para"), pick(q("header"), "header"), pick(q("footer"), "footer"),
    pick(q("header a"), "navLink"), pick(q("a.button, .button, .btn"), "btn"),
  ]);
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
