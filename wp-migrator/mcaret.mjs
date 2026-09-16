import { chromium } from "playwright";
const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await c.newPage();
await p.goto("http://localhost:4324/", { waitUntil: "networkidle", timeout: 60000 });
await p.waitForTimeout(1000);
const idx = await p.evaluate(() => Array.from(document.querySelectorAll(".desktop-main-nav .nav-item.has-children")).findIndex((e) => e.querySelector(":scope > a")?.textContent.trim() === "Dental Services"));
const li = p.locator(".desktop-main-nav .nav-item.has-children").nth(idx);
const caret = () => p.evaluate((i) => {
  const el = document.querySelectorAll(".desktop-main-nav .nav-item.has-children")[i];
  const ic = el.querySelector(":scope > .nav-item-trigger .nav-item-icon");
  const tr = el.querySelector(":scope > .nav-item-trigger");
  const s = getComputedStyle(ic);
  return { transform: s.transform, border: getComputedStyle(tr).borderTopWidth,
    bg: getComputedStyle(tr).backgroundColor };
}, idx);
console.log("closed:", JSON.stringify(await caret()));
await li.locator("> .nav-item-trigger").click();
await p.waitForTimeout(600);
console.log("open:  ", JSON.stringify(await caret()));
await b.close();
