import { chromium } from "playwright";
const [url, out, mode] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await p.goto(url, { waitUntil: "networkidle", timeout: 60000 });
await p.waitForTimeout(1500);
if (mode === "footer") {
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await p.waitForTimeout(900);
  const f = await p.$("footer");
  if (f) await f.screenshot({ path: out });
  else await p.screenshot({ path: out });
} else {
  await p.screenshot({ path: out, clip: { x: 0, y: 0, width: 1440, height: 320 } });
}
await b.close();
