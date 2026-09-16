import { chromium } from "playwright";
import { createServer } from "node:http";
import fs from "node:fs"; import path from "node:path";
const ROOT=process.argv[2],PAGE=process.argv[3];
const MIME={".html":"text/html",".css":"text/css",".js":"text/javascript",".jpg":"image/jpeg",".png":"image/png",".woff2":"font/woff2"};
const s=createServer((q,r)=>{let p=decodeURIComponent(q.url.split("?")[0]); if(p==="/")p="/"+PAGE;
 const f=path.join(ROOT,p);
 if(fs.existsSync(f)&&fs.statSync(f).isFile()){r.writeHead(200,{"content-type":MIME[path.extname(f).toLowerCase()]||"application/octet-stream"});fs.createReadStream(f).pipe(r);}else{r.writeHead(404);r.end();}});
await new Promise(r=>s.listen(0,r));
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:900}});
await p.goto(`http://localhost:${s.address().port}/${PAGE}`,{waitUntil:"networkidle"}); await p.waitForTimeout(1200);
console.log(JSON.stringify(await p.evaluate(()=>{
  const h1=document.querySelector("h1"), sp=document.querySelector("h1 span");
  const cs=e=>e?{color:getComputedStyle(e).color,size:getComputedStyle(e).fontSize,weight:getComputedStyle(e).fontWeight,tt:getComputedStyle(e).textTransform,display:getComputedStyle(e).display}:"—";
  const intro=document.querySelector(".inner-intro");
  const cols=intro?[...intro.querySelectorAll(":scope > .row > div")].map(c=>{const r=c.getBoundingClientRect();return{cls:c.className,w:Math.round(r.width),x:Math.round(r.x)};}):[];
  return {h1:cs(h1), span:cs(sp), h1text:h1?.textContent.trim().slice(0,50), cols};
}),null,1));
await b.close(); s.close();
