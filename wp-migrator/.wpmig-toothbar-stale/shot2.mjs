import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const base = "http://localhost:4340";
const out = "/Users/tharvey/Work/CloudCannon/toothbar/wp-migrator/.wpmig/shots";
mkdirSync(out, { recursive: true });
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const route = process.argv[2] || "/";
const name = process.argv[3] || "page";
await p.goto(base + route, { waitUntil: "domcontentloaded", timeout: 60000 });
await p.waitForTimeout(5000);
await p.evaluate(async () => {
  await new Promise((r) => {
    let y = 0;
    const t = setInterval(() => {
      window.scrollTo(0, y);
      y += 600;
      if (y > document.body.scrollHeight) { clearInterval(t); r(); }
    }, 40);
  });
});
await p.waitForTimeout(800);
await p.screenshot({ path: `${out}/${name}-full.png`, fullPage: true });
await b.close();
console.log("shot", name);
