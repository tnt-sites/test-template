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
  const sel = mode==="snap" ? ".call-out" : ".callout-bubble";
  const e=document.querySelector(sel);
  if(!e) return "none";
  const cs=getComputedStyle(e); const r=e.getBoundingClientRect();
  const a=getComputedStyle(e,"::after");
  const t=e.querySelector("p");
  return {w:Math.round(r.width),h:Math.round(r.height),x:Math.round(r.x),
    bg:cs.backgroundColor,radius:cs.borderRadius,pad:cs.padding,maxW:cs.maxWidth,
    align:cs.textAlign, fontSize:t?getComputedStyle(t).fontSize:"—",
    tail:{content:a.content,border:a.borderTop,left:a.left,top:a.top,w:a.width,h:a.height}};
}, process.argv[2]),null,1));
await b.close(); if(server) server.close();
