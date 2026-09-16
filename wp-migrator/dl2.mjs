import { chromium } from "playwright";
import { createServer } from "node:http";
import fs from "node:fs"; import path from "node:path";
const ROOT=process.argv[2], PAGE=process.argv[3];
const MIME={".html":"text/html",".css":"text/css",".js":"text/javascript",".jpg":"image/jpeg",".png":"image/png",".woff2":"font/woff2"};
const s=createServer((q,r)=>{let p=decodeURIComponent(q.url.split("?")[0]); if(p==="/")p="/"+PAGE;
  const f=path.join(ROOT,p);
  if(fs.existsSync(f)&&fs.statSync(f).isFile()){r.writeHead(200,{"content-type":MIME[path.extname(f).toLowerCase()]||"application/octet-stream"});fs.createReadStream(f).pipe(r);}else{r.writeHead(404);r.end();}});
await new Promise(r=>s.listen(0,r));
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:900}});
await p.goto(`http://localhost:${s.address().port}/${PAGE}`,{waitUntil:"networkidle"}); await p.waitForTimeout(1200);
console.log(JSON.stringify(await p.evaluate(()=>{
  const dts=[...document.querySelectorAll(".definitions dt")].slice(0,4);
  const dds=[...document.querySelectorAll(".definitions dd")].slice(0,4);
  const g=e=>{const r=e.getBoundingClientRect(); const cs=getComputedStyle(e);
    return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),
      style:cs.fontStyle,weight:cs.fontWeight,size:cs.fontSize,color:cs.color,
      text:(e.textContent||"").trim().slice(0,24)};};
  return {dt:dts.map(g), dd:dds.map(g)};
}),null,1));
await b.close(); s.close();
