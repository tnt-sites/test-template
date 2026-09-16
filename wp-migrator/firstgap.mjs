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
await p.goto(url,{waitUntil:"networkidle",timeout:60000}); await p.waitForTimeout(1500);
console.log(JSON.stringify(await p.evaluate((mode)=>{
  const colSel = mode==="snap" ? ".main-body" : ".cws-main";
  const secSel = mode==="snap" ? ".section-block" : ".custom-section, .page-banner";
  const col=document.querySelector(colSel);
  const side=document.querySelector(mode==="snap" ? ".side-bar" : ".cws-side");
  if(!col) return "no column";
  const first=col.querySelector(secSel);
  const firstSide=side?.querySelector(secSel);
  const g=(e)=>{if(!e) return "—"; const cs=getComputedStyle(e); const r=e.getBoundingClientRect();
    return {top:Math.round(r.top+window.scrollY), mT:cs.marginTop, mB:cs.marginBottom,
      label:(e.querySelector("h1,h2,h3,h4,h5")?.textContent||"").trim().slice(0,30)};};
  const colBox=col.getBoundingClientRect();
  return {columnTop:Math.round(colBox.top+window.scrollY),
    firstSection:g(first), firstSidebar:g(firstSide),
    gapAboveFirst: first ? Math.round(first.getBoundingClientRect().top - colBox.top) : null};
}, process.argv[2]),null,1));
await b.close(); if(server) server.close();
