import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { serve } from "../src/mirror/serve.mjs";
const out = "/private/tmp/claude-501/-Users-tharvey-Work-CloudCannon-artisan/719215e4-ab97-4ee9-8e34-f794031dd6d4/scratchpad";
const which = process.argv[2] || "built";
const dir = which === "source"
  ? fileURLToPath(new URL("../static", import.meta.url))
  : fileURLToPath(new URL("../../dist", import.meta.url));
const file = which === "source" ? "index.html" : "index.html";
const { server, url } = await serve(dir, 0);
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 620 } });
await page.goto(`${url}/${file}`, { waitUntil: "networkidle" }).catch(()=>{});
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/${which}-hdr.png` });
await b.close(); server.close();
