import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto(process.argv[2], { waitUntil: "networkidle" });
await p.waitForTimeout(1000);
console.log(JSON.stringify(await p.evaluate(() => {
  const out = {};
  for (const sel of [".main-nav .hd-content", ".main-nav .hd-right", ".main-nav .hd-info", ".main-nav .hd-btns", ".main-nav .hd-nav"]) {
    const el = document.querySelector(sel);
    if (!el) { out[sel] = "MISSING"; continue; }
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    out[sel] = { display: cs.display, gridArea: cs.gridArea, order: cs.order,
      box: `${Math.round(r.width)}x${Math.round(r.height)} @${Math.round(r.x)},${Math.round(r.y)}` };
  }
  return out;
}), null, 1));
await b.close();
