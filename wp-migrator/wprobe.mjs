import { chromium } from "playwright";
import { createServer } from "node:http";
import fs from "node:fs"; import path from "node:path";
const ROOT=process.argv[2], PAGE=process.argv[3];
const MIME={".html":"text/html",".css":"text/css",".js":"text/javascript",".jpg":"image/jpeg",".png":"image/png",".svg":"image/svg+xml",".woff2":"font/woff2",".woff":"font/woff"};
const s=createServer((q,r)=>{let p=decodeURIComponent(q.url.split("?")[0]); if(p==="/")p="/"+PAGE;
  const f=path.join(ROOT,p);
  if(fs.existsSync(f)&&fs.statSync(f).isFile()){r.writeHead(200,{"content-type":MIME[path.extname(f).toLowerCase()]||"application/octet-stream"});fs.createReadStream(f).pipe(r);}
  else{r.writeHead(404);r.end();}});
await new Promise(r=>s.listen(0,r));
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:900}});
await p.goto(`http://localhost:${s.address().port}/${PAGE}`,{waitUntil:"networkidle"});
await p.waitForTimeout(1200);
console.log(JSON.stringify(await p.evaluate(()=>{
  const o={};
  const meas=(sel,label)=>{const e=document.querySelector(sel); if(!e){o[label]="—";return;}
    const r=e.getBoundingClientRect(); const cs=getComputedStyle(e);
    o[label]={w:Math.round(r.width),x:Math.round(r.x),maxw:cs.maxWidth,pad:cs.paddingLeft};};
  meas(".main-service-content","content section");
  meas(".main-service-content p","content paragraph");
  meas(".definitions","definitions");
  meas(".definitions dl","definitions dl");
  meas(".definition-flex","definition row");
  meas(".definitions .col","definition col");
  meas(".container","container");
  meas(".call-out","call-out");
  meas("#related-topics","sidebar related-topics");
  return o;
}),null,1));
await b.close(); s.close();
