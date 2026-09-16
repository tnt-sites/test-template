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
  const intro=document.querySelector(".inner-intro");
  const cols=[...(intro?.querySelectorAll(":scope > .row > div")||[])].map(c=>{
    const r=c.getBoundingClientRect();
    return {cls:c.className.slice(0,22),h:Math.round(r.height),y:Math.round(r.top+window.scrollY)};});
  const img=intro?.querySelector("img");
  const ir=img?.getBoundingClientRect();
  return {bannerH:Math.round(intro?.getBoundingClientRect().height||0),
    cols, img: ir?{h:Math.round(ir.height),y:Math.round(ir.top+window.scrollY)}:"—",
    rowAlign: intro?getComputedStyle(intro.querySelector(".row")||intro).alignItems:"—"};
}),null,1));
await b.close(); s.close();
