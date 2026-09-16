import { chromium } from "playwright";
import { createServer } from "node:http";
import fs from "node:fs"; import path from "node:path";
const MODE=process.argv[2];
let url=process.argv[3], server=null;
if (MODE==="snap") {
  const ROOT=process.argv[4], PAGE=process.argv[5];
  const MIME={".html":"text/html",".css":"text/css",".js":"text/javascript",".jpg":"image/jpeg",".png":"image/png",".woff2":"font/woff2",".woff":"font/woff",".ttf":"font/ttf",".svg":"image/svg+xml",".eot":"application/vnd.ms-fontobject"};
  server=createServer((q,r)=>{let p=decodeURIComponent(q.url.split("?")[0]); if(p==="/")p="/"+PAGE;
    const f=path.join(ROOT,p);
    if(fs.existsSync(f)&&fs.statSync(f).isFile()){r.writeHead(200,{"content-type":MIME[path.extname(f).toLowerCase()]||"application/octet-stream"});fs.createReadStream(f).pipe(r);}else{r.writeHead(404);r.end();}});
  await new Promise(r=>server.listen(0,r));
  url=`http://localhost:${server.address().port}/${PAGE}`;
}
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:900}});
await p.goto(url,{waitUntil:"networkidle",timeout:60000}); await p.waitForTimeout(1800);
console.log(JSON.stringify(await p.evaluate(async()=>{
  await document.fonts.ready;
  const loaded=[...document.fonts].filter(f=>f.status==="loaded")
    .map(f=>`${f.family}|${f.weight}|${f.style}`);
  const pick=(sel)=>{
    for(const e of document.querySelectorAll(sel)){
      const r=e.getBoundingClientRect();
      if(r.width<60||r.height<8) continue;
      if(e.closest("nav,header,footer,.main-nav,.side-nav")) continue;
      const cs=getComputedStyle(e);
      return {family:cs.fontFamily.split(",")[0].replace(/"/g,""), weight:cs.fontWeight,
        size:cs.fontSize, synth:cs.fontSynthesis, smooth:cs.webkitFontSmoothing,
        text:(e.textContent||"").trim().slice(0,20)};
    }
    return "—";
  };
  return {fontsLoaded:[...new Set(loaded)].sort(), body:pick("p"), li:pick("li"),
    h2:pick("h2"), h3:pick("h3"), dt:pick("dt")};
}),null,1));
await b.close(); if(server) server.close();
