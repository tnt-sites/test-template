import { chromium } from "playwright";
import { createServer } from "node:http";
import fs from "node:fs"; import path from "node:path";
const ROOT=process.argv[2], PAGE=process.argv[3];
const MIME={".html":"text/html",".css":"text/css",".js":"text/javascript",".jpg":"image/jpeg",".png":"image/png",".svg":"image/svg+xml",".woff2":"font/woff2",".woff":"font/woff"};
const s=createServer((q,r)=>{let p=decodeURIComponent(q.url.split("?")[0]); if(p==="/")p="/"+PAGE;
  const f=path.join(ROOT,p);
  if(fs.existsSync(f)&&fs.statSync(f).isFile()){r.writeHead(200,{"content-type":MIME[path.extname(f).toLowerCase()]||"application/octet-stream"});fs.createReadStream(f).pipe(r);}else{r.writeHead(404);r.end();}});
await new Promise(r=>s.listen(0,r));
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:900}});
await p.goto(`http://localhost:${s.address().port}/${PAGE}`,{waitUntil:"networkidle"}); await p.waitForTimeout(1200);
console.log(JSON.stringify(await p.evaluate(()=>{
  const g=(sel)=>{const e=document.querySelector(sel); if(!e) return "—";
    const cs=getComputedStyle(e); const r=e.getBoundingClientRect();
    return {bg:cs.backgroundColor, w:Math.round(r.width), x:Math.round(r.x),
      pad:cs.padding, shadow:cs.boxShadow.slice(0,40), radius:cs.borderRadius, margin:cs.margin};};
  return {
    body:g("body"), mainBody:g(".main-body"),
    contentSection:g(".main-service-content"),
    definitions:g(".definitions"), defDt:g(".definitions dt"), defDd:g(".definitions dd"),
    faq:g(".faq-section"),
    trust:g(".related-links"),
    callout:g(".call-out"),
    sidebarPanel:g(".side-bar .related-topics"),
  };
}),null,1));
await b.close(); s.close();
