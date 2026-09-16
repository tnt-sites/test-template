import { chromium } from "playwright";
import { createServer } from "node:http";
import fs from "node:fs"; import path from "node:path";
const MODE=process.argv[2];
let url=process.argv[3], server=null;
if (MODE==="snap") {
  const ROOT=process.argv[4], PAGE=process.argv[5];
  const MIME={".html":"text/html",".css":"text/css",".js":"text/javascript",".jpg":"image/jpeg",".png":"image/png",".woff2":"font/woff2",".woff":"font/woff",".ttf":"font/ttf",".svg":"image/svg+xml"};
  server=createServer((q,r)=>{let p=decodeURIComponent(q.url.split("?")[0]); if(p==="/")p="/"+PAGE;
    const f=path.join(ROOT,p);
    if(fs.existsSync(f)&&fs.statSync(f).isFile()){r.writeHead(200,{"content-type":MIME[path.extname(f).toLowerCase()]||"application/octet-stream"});fs.createReadStream(f).pipe(r);}else{r.writeHead(404);r.end();}});
  await new Promise(r=>server.listen(0,r));
  url=`http://localhost:${server.address().port}/${PAGE}`;
}
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:1000}});
await p.goto(url,{waitUntil:"networkidle",timeout:60000}); await p.waitForTimeout(1800);
console.log(JSON.stringify(await p.evaluate((mode)=>{
  const root = mode==="snap" ? document.querySelector(".inner-intro") : document.querySelector(".page-banner");
  if(!root) return "no banner";
  const box=e=>{if(!e) return "—"; const r=e.getBoundingClientRect(); const cs=getComputedStyle(e);
    return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),
      bg:cs.backgroundColor,pad:cs.padding,size:cs.fontSize,weight:cs.fontWeight,align:cs.textAlign};};
  const r=root.getBoundingClientRect();
  const img=root.querySelector("img");
  const h1=root.querySelector("h1");
  const span=root.querySelector("h1 span, .pb-location");
  const para=root.querySelector("p");
  const frame=root.querySelector("iframe");
  const formTitle=root.querySelector(".form-title, .pb-form-title");
  const cols = mode==="snap"
    ? [...root.querySelectorAll(":scope > .row > div")]
    : [...root.querySelectorAll(":scope > .pb-grid > *")];
  return {banner:{w:Math.round(r.width),h:Math.round(r.height),y:Math.round(r.y+window.scrollY),
      bg:getComputedStyle(root).backgroundColor},
    cols:cols.map(c=>{const cr=c.getBoundingClientRect();
      return {cls:(typeof c.className==="string"?c.className:"").slice(0,26),
        w:Math.round(cr.width),x:Math.round(cr.x),h:Math.round(cr.height)};}),
    img:box(img), h1:box(h1), location:box(span), intro:box(para),
    iframe:box(frame), formTitle:box(formTitle),
    formTitleText:(formTitle?.textContent||"").trim().slice(0,30)};
}, process.argv[2]),null,1));
await b.close(); if(server) server.close();
