import { chromium } from "playwright";
const base = "http://localhost:4331";
const out = "/Users/tharvey/Work/CloudCannon/toothbar/wp-migrator/.wpmig/shots";
import { mkdirSync } from "node:fs";
mkdirSync(out, { recursive: true });
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const url = process.argv[2] || "/";
await p.goto(base + url, { waitUntil: "domcontentloaded", timeout: 60000 });
await p.waitForTimeout(800);
await p.screenshot({ path: `${out}/bar.png` });
// open overlay
const ham = p.locator(".tb-hamburger").first();
if (await ham.count()) {
  await ham.click();
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${out}/overlay.png` });
}
await b.close();
console.log("done");
