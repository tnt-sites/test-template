import { chromium } from "playwright";
import { createServer } from "node:http";
import fs from "node:fs"; import path from "node:path";
const ROOT=process.argv[2], PAGE=process.argv[3];
const MIME={".html":"text/html",".css":"text/css",".js":"text/javascript",".jpg":"image/jpeg",".png":"image/png",".woff2":"font/woff2",".woff":"font/woff",".ttf":"font/ttf",".svg":"image/svg+xml"};
const s=createServer((q,r)=>{let p=decodeURIComponent(q.url.split("?")[0]); if(p==="/")p="/"+PAGE;
  const f=path.join(ROOT,p);
  if(fs.existsSync(f)&&fs.statSync(f).isFile()){r.writeHead(200,{"content-type":MIME[path.extname(f).toLowerCase()]||"application/octet-stream"});fs.createReadStream(f).pipe(r);}else{r.writeHead(404);r.end();}});
await new Promise(r=>s.listen(0,r));
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:1000}});
await p.goto(`http://localhost:${s.address().port}/${PAGE}`,{waitUntil:"networkidle"}); await p.waitForTimeout(1500);
console.log(JSON.stringify(await p.evaluate(()=>{
  const out=[];
  document.querySelectorAll(".main-body .section-block").forEach(e=>{
    const cs=getComputedStyle(e); const r=e.getBoundingClientRect();
    const h=e.querySelector("h1,h2,h3,h4,h5");
    out.push({cls:e.className.replace(/\s+/g," ").slice(0,52),
      bg:cs.backgroundColor, mT:cs.marginTop, mB:cs.marginBottom,
      pad:cs.padding, heading:(h?.textContent||"").trim().slice(0,38)});
  });
  // definition list internals
  const dl=document.querySelector(".definitions dl");
  const item=document.querySelector(".definitions .definition-flex > div, .definitions .col");
  const dt=document.querySelector(".definitions dt"), dd=document.querySelector(".definitions dd");
  const dfn=document.querySelector(".definitions dfn");
  const g=e=>{if(!e) return "—"; const cs=getComputedStyle(e); const r=e.getBoundingClientRect();
    return {style:cs.fontStyle,weight:cs.fontWeight,size:cs.fontSize,
      borderTop:cs.borderTop, mT:cs.marginTop, mB:cs.marginBottom, padT:cs.paddingTop,
      w:Math.round(r.width), x:Math.round(r.x)};};
  return {sections:out, dl:g(dl), item:g(item), dt:g(dt), dd:g(dd), dfn:g(dfn),
    dtHasDfn: !!document.querySelector(".definitions dt dfn")};
}),null,1));
await b.close(); s.close();
