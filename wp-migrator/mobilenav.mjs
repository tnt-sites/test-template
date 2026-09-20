// Verifies the mobile drawer opens via hamburger and closes via the X button.
import { chromium } from "playwright";
import { createServer } from "node:http";
import fs from "node:fs"; import path from "node:path";
const ROOT = process.argv[2];
const MIME={".html":"text/html",".css":"text/css",".js":"text/javascript",".jpg":"image/jpeg",".png":"image/png",".svg":"image/svg+xml",".avif":"image/avif",".webp":"image/webp",".woff2":"font/woff2",".woff":"font/woff"};
const s=createServer((q,r)=>{let p=decodeURIComponent(q.url.split("?")[0]);
  if(p.endsWith("/"))p+="index.html";
  const f=path.join(ROOT,p);
  if(fs.existsSync(f)&&fs.statSync(f).isFile()){r.writeHead(200,{"content-type":MIME[path.extname(f).toLowerCase()]||"application/octet-stream"});fs.createReadStream(f).pipe(r);}
  else{r.writeHead(404);r.end();}});
await new Promise(r=>s.listen(0,r));
const port=s.address().port;
const b=await chromium.launch();
const page=await b.newPage({viewport:{width:390,height:844}});
const errs=[]; page.on("pageerror",e=>errs.push(String(e)));
await page.goto(`http://localhost:${port}/`,{waitUntil:"networkidle"});
await page.waitForTimeout(700);

const vis = async () => await page.evaluate(()=>{
  const n=document.querySelector(".mobile");
  if(!n) return "no-nav";
  const r=n.getBoundingClientRect();
  return {onscreen: r.left > -50, ariaHidden: n.getAttribute("aria-hidden"), transform:getComputedStyle(n).transform.slice(0,30)};
});

console.log("closed at start:", JSON.stringify(await vis()));
await page.click(".nav-hamburger");
await page.waitForTimeout(600);
console.log("after hamburger:", JSON.stringify(await vis()));

const closeTag = await page.evaluate(()=>{const e=document.querySelector(".mobile-close");return e?e.tagName+" type="+(e.getAttribute("type")||"-"):"MISSING";});
console.log("close element:", closeTag);

await page.click(".mobile-close");
await page.waitForTimeout(600);
console.log("after close X: ", JSON.stringify(await vis()));

// keyboard: Enter on the close button should fire exactly once
await page.click(".nav-hamburger"); await page.waitForTimeout(500);
await page.focus(".mobile-close");
await page.keyboard.press("Enter");
await page.waitForTimeout(600);
console.log("after Enter on X:", JSON.stringify(await vis()));

console.log("page errors:", errs.length? errs : "none");
await b.close(); s.close();
