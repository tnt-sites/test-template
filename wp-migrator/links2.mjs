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
  const sample=(sel,label,n=3)=>{
    const out=[];
    document.querySelectorAll(sel).forEach(a=>{
      if(out.length>=n) return;
      const r=a.getBoundingClientRect(); if(r.width<10) return;
      const cs=getComputedStyle(a);
      out.push({text:(a.textContent||"").trim().slice(0,26), color:cs.color,
        deco:cs.textDecorationLine, decoStyle:cs.textDecorationStyle,
        borderBottom:cs.borderBottom, cls:a.className.slice(0,24)});
    });
    return [label,out];
  };
  return Object.fromEntries([
    sample(".main-service-content p a","paragraph links"),
    sample(".main-service-content li a","content list links"),
    sample(".faq-section a","faq links"),
    sample(".side-bar a","sidebar links"),
    sample(".related-links a","trust links"),
  ]);
}),null,1));
await b.close(); s.close();
