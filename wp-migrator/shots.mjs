import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const OUT = process.argv[2];
const PORT = process.argv[3] || "4324";
const pages = JSON.parse(process.argv[4]);

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });

async function shoot(url, file) {
  const p = await ctx.newPage();
  try {
    await p.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await p.waitForTimeout(1200);
    // settle lazy images
    await p.evaluate(async () => {
      await new Promise((r) => { let y=0; const t=setInterval(()=>{ window.scrollTo(0,y); y+=800;
        if (y > document.body.scrollHeight) { clearInterval(t); window.scrollTo(0,0); r(); } }, 40); });
    });
    await p.waitForTimeout(600);
    await p.screenshot({ path: file, fullPage: true });
    return true;
  } catch (e) {
    console.log(`  FAIL ${url}: ${e.message.split("\n")[0]}`);
    return false;
  } finally { await p.close(); }
}

for (const [slug, livePath] of pages) {
  const a = path.join(OUT, `${slug}--live.png`);
  const b = path.join(OUT, `${slug}--new.png`);
  const okA = await shoot(`https://www.ultimatesmiles.com${livePath}`, a);
  const okB = await shoot(`http://localhost:${PORT}${livePath}`, b);
  console.log(`${slug}: live=${okA} new=${okB}`);
}
await browser.close();
