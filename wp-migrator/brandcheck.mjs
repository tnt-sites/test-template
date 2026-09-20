// Samples the computed colour of every element that should follow branding.json.
import { chromium } from "playwright";
import { createServer } from "node:http";
import fs from "node:fs"; import path from "node:path";
const ROOT = process.argv[2];
const PAGES = process.argv.slice(3);
const MIME={".html":"text/html",".css":"text/css",".js":"text/javascript",".jpg":"image/jpeg",".png":"image/png",".svg":"image/svg+xml",".avif":"image/avif",".webp":"image/webp",".woff2":"font/woff2",".woff":"font/woff"};
const s=createServer((q,r)=>{let p=decodeURIComponent(q.url.split("?")[0]);
  if(p.endsWith("/"))p+="index.html";
  const f=path.join(ROOT,p);
  if(fs.existsSync(f)&&fs.statSync(f).isFile()){r.writeHead(200,{"content-type":MIME[path.extname(f).toLowerCase()]||"application/octet-stream"});fs.createReadStream(f).pipe(r);}
  else{r.writeHead(404);r.end();}});
await new Promise(r=>s.listen(0,r));
const port = s.address().port;
const b = await chromium.launch();
const page = await b.newPage({viewport:{width:1440,height:900}});
for (const P of PAGES) {
  await page.goto(`http://localhost:${port}${P}`, {waitUntil:"networkidle"});
  await page.waitForTimeout(600);
  const out = await page.evaluate(() => {
    const rs = getComputedStyle(document.documentElement);
    const vars = {};
    for (const v of ["--color-brand","--color-brand-secondary","--color-brand-secondary-hover",
      "--color-brand-secondary-light","--color-brand-hover","--color-text-on-brand",
      "--color-bg-gold","--color-bg-accent","--color-accent"]) vars[v]=rs.getPropertyValue(v).trim();
    const samples = {};
    const grab = (label, sel, prop="backgroundColor") => {
      const e = document.querySelector(sel);
      if (e) samples[label] = getComputedStyle(e)[prop];
    };
    grab("button.bg", ".button, .btn");
    grab("button.fg", ".button, .btn", "color");
    grab("pf-button", ".pf-button");
    grab("bg-gold", ".custom-section.bg-gold");
    grab("callout", ".callout-bubble");
    grab("ss-submit", ".ss-submit");
    grab("ir-button", ".ir-button");
    grab("dropdown", ".main-nav .dropdown-content");
    return {vars, samples};
  });
  console.log("\n==", P);
  console.log(" vars:", JSON.stringify(out.vars, null, 0));
  console.log(" painted:", JSON.stringify(out.samples, null, 0));
}
await b.close(); s.close();
