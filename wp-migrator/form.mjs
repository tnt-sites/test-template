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
await p.goto(url,{waitUntil:"networkidle",timeout:60000}); await p.waitForTimeout(2500);
console.log(JSON.stringify(await p.evaluate(()=>{
  const g=(e,label)=>{if(!e) return [label,"—"]; const r=e.getBoundingClientRect(); const cs=getComputedStyle(e);
    return [label,{x:Math.round(r.x),y:Math.round(r.y+window.scrollY),w:Math.round(r.width),h:Math.round(r.height),
      cssH:cs.height, minH:cs.minHeight, bg:cs.backgroundColor, overflow:cs.overflow}];};
  const iframe=document.querySelector("iframe[src*='liine'],iframe[id*='JotForm']");
  const card=document.querySelector(".pb-form-card, .form-wrapper-default, .contact-form");
  const wrap=document.querySelector(".pb-form, .inner-form-wrapper");
  return Object.fromEntries([g(iframe,"iframe"),g(card,"card"),g(wrap,"wrapper"),
    ["iframeAttrHeight", iframe?.getAttribute("style")||""],
    ["docHeight", document.body.scrollHeight]]);
}),null,1));
await b.close(); if(server) server.close();
