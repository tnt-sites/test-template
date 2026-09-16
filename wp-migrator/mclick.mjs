import { chromium } from "playwright";
const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await c.newPage();
const S = process.argv[2];
await p.goto("http://localhost:4324/", { waitUntil: "networkidle", timeout: 60000 });
await p.waitForTimeout(1200);

const item = '.desktop-main-nav .nav-item.has-children';
const findLi = (label) => Array.from(document.querySelectorAll(".desktop-main-nav .nav-item.has-children"))
  .find((e) => e.querySelector(":scope > a")?.textContent.trim() === label);
const state = () => p.evaluate((label) => {
  const li = Array.from(document.querySelectorAll(".desktop-main-nav .nav-item.has-children"))
    .find((e) => e.querySelector(":scope > a")?.textContent.trim() === label);
  const panel = li.querySelector(".nav-item-content");
  const trig = li.querySelector(":scope > .nav-item-trigger");
  const cb = li.querySelector(":scope > .nav-item-toggle");
  const pb = panel.getBoundingClientRect();
  const tb = trig ? trig.getBoundingClientRect() : null;
  return { panelDisplay: getComputedStyle(panel).display,
    panelX: Math.round(pb.x), panelW: Math.round(pb.width), panelH: Math.round(pb.height),
    panelBg: getComputedStyle(panel).backgroundColor,
    caretVisible: trig ? getComputedStyle(trig).display !== "none" : false,
    caretW: tb ? Math.round(tb.width) : null,
    checked: cb ? cb.checked : null,
    ariaExpanded: trig ? trig.getAttribute("aria-expanded") : null };
}, "Dental Services");

console.log("1. initial          ", JSON.stringify(await state()));
const idx = await p.evaluate(() => Array.from(document.querySelectorAll(".desktop-main-nav .nav-item.has-children")).findIndex((e) => e.querySelector(":scope > a")?.textContent.trim() === "Dental Services"));
const li = p.locator(".desktop-main-nav .nav-item.has-children").nth(idx);
await li.hover();
await p.waitForTimeout(700);
console.log("2. after HOVER      ", JSON.stringify(await state()));
await li.locator("> .nav-item-trigger").click();
await p.waitForTimeout(700);
console.log("3. after CLICK caret", JSON.stringify(await state()));
await p.screenshot({ path: `${S}/click-open.png`, clip: { x: 0, y: 0, width: 1440, height: 620 } });
await li.locator("> .nav-item-trigger").click();
await p.waitForTimeout(700);
console.log("4. click again      ", JSON.stringify(await state()));
await li.locator("> .nav-item-trigger").click();
await p.waitForTimeout(500);
await p.mouse.click(720, 780);
await p.waitForTimeout(600);
console.log("5. click outside    ", JSON.stringify(await state()));
await li.locator("> .nav-item-trigger").click();
await p.waitForTimeout(400);
await p.keyboard.press("Escape");
await p.waitForTimeout(500);
console.log("6. Escape           ", JSON.stringify(await state()));
await b.close();
