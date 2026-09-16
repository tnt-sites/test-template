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
await p.goto(`http://localhost:${s.address().port}/${PAGE}`,{waitUntil:"networkidle"}); await p.waitForTimeout(1500);
console.log(JSON.stringify(await p.evaluate(()=>{
  const out=[];
  for (const sel of ["h1","h2","h3","h4","p","li"]) {
    document.querySelectorAll(sel).forEach(e=>{
      const r=e.getBoundingClientRect();
      if(r.width<60||r.height<8) return;
      if(e.closest("nav,header,footer,.main-nav,.side-nav,.bar,.breadcrumbs")) return;
      const cs=getComputedStyle(e);
      out.push({tag:sel,size:cs.fontSize,weight:cs.fontWeight,lh:cs.lineHeight,tt:cs.textTransform,
        text:(e.textContent||"").trim().slice(0,32)});
    });
  }
  // unique by tag+size+weight
  const seen=new Set(); return out.filter(o=>{const k=o.tag+o.size+o.weight+o.tt; if(seen.has(k))return false; seen.add(k); return true;}).slice(0,16);
}),null,1));
await b.close(); s.close();
