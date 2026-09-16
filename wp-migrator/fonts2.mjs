import { chromium } from "playwright";
import { createServer } from "node:http";
import fs from "node:fs"; import path from "node:path";
const MODE=process.argv[2], TARGET=process.argv[3];
let url=TARGET, server=null;
if (MODE==="snap") {
  const ROOT=process.argv[4], PAGE=process.argv[5];
  const MIME={".html":"text/html",".css":"text/css",".js":"text/javascript",".jpg":"image/jpeg",".png":"image/png",".svg":"image/svg+xml",".woff2":"font/woff2",".woff":"font/woff"};
  server=createServer((q,r)=>{let p=decodeURIComponent(q.url.split("?")[0]); if(p==="/")p="/"+PAGE;
    const f=path.join(ROOT,p);
    if(fs.existsSync(f)&&fs.statSync(f).isFile()){r.writeHead(200,{"content-type":MIME[path.extname(f).toLowerCase()]||"application/octet-stream"});fs.createReadStream(f).pipe(r);}else{r.writeHead(404);r.end();}});
  await new Promise(r=>server.listen(0,r));
  url=`http://localhost:${server.address().port}/${PAGE}`;
}
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:900}});
await p.goto(url,{waitUntil:"networkidle",timeout:60000}); await p.waitForTimeout(1200);
console.log(JSON.stringify(await p.evaluate(()=>{
  const seen={}; const out={};
  // sample the first visible instance of each text role in the main content
  const roles=[["h1","h1"],["h2","h2"],["h3","h3"],["h4","h4"],["h5","h5"],
    ["p","paragraph"],["li","list item"],["dt","definition term"],["dd","definition text"],
    ["a","link"]];
  const inMain=(e)=>{const m=document.querySelector(".main-section,.entry-content,main,.cws-main");
    return m? m.contains(e) : true;};
  for (const [sel,label] of roles) {
    for (const e of document.querySelectorAll(sel)) {
      const r=e.getBoundingClientRect();
      if (r.width<40 || r.height<6) continue;
      if (!inMain(e)) continue;
      const cs=getComputedStyle(e);
      out[label]={size:cs.fontSize, weight:cs.fontWeight, lh:cs.lineHeight,
        family:cs.fontFamily.split(",")[0].replace(/"/g,""), tt:cs.textTransform};
      break;
    }
  }
  return out;
}),null,1));
await b.close(); if(server) server.close();
