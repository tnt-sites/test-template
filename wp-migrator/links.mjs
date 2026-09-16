import { chromium } from "playwright";
import { createServer } from "node:http";
import fs from "node:fs"; import path from "node:path";
const ROOT=process.argv[2], PAGE=process.argv[3];
const MIME={".html":"text/html",".css":"text/css",".js":"text/javascript",".jpg":"image/jpeg",".png":"image/png",".woff2":"font/woff2",".svg":"image/svg+xml"};
const s=createServer((q,r)=>{let p=decodeURIComponent(q.url.split("?")[0]); if(p==="/")p="/"+PAGE;
  const f=path.join(ROOT,p);
  if(fs.existsSync(f)&&fs.statSync(f).isFile()){r.writeHead(200,{"content-type":MIME[path.extname(f).toLowerCase()]||"application/octet-stream"});fs.createReadStream(f).pipe(r);}else{r.writeHead(404);r.end();}});
await new Promise(r=>s.listen(0,r));
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:900}});
await p.goto(`http://localhost:${s.address().port}/${PAGE}`,{waitUntil:"networkidle"}); await p.waitForTimeout(1200);
console.log(JSON.stringify(await p.evaluate(()=>{
  const g=(e)=>{if(!e) return "—"; const cs=getComputedStyle(e); const r=e.getBoundingClientRect();
    return {color:cs.color, deco:cs.textDecorationLine, marker:cs.listStyleType,
      padL:cs.paddingLeft, marL:cs.marginLeft, x:Math.round(r.x)};};
  const mk=(e)=>{if(!e) return "—"; const m=getComputedStyle(e,"::marker");
    return {color:m.color, content:m.content};};
  const out={};
  // content list
  const cl=document.querySelector(".main-service-content ul, .bullet-list");
  out.contentUl=g(cl); out.contentLi=g(cl?.querySelector("li"));
  out.contentMarker=mk(cl?.querySelector("li"));
  out.contentLink=g(document.querySelector(".main-service-content p a"));
  out.contentLiLink=g(cl?.querySelector("li a"));
  // FAQ block
  const fq=document.querySelector(".faq-section");
  out.faqPara=g(fq?.querySelector("p.questions"));
  out.faqLink=g(fq?.querySelector("p.questions a"));
  out.faqHasUl=!!fq?.querySelector("ul");
  // sidebar
  const sb=document.querySelector(".side-bar");
  out.sideUl=g(sb?.querySelector("ul")); out.sideLi=g(sb?.querySelector("li"));
  out.sideMarker=mk(sb?.querySelector("li"));
  out.sideLink=g(sb?.querySelector("li a"));
  // back-to-top / breadcrumbs position
  const bt=[...document.querySelectorAll("p")].find(e=>/Back to top of/.test(e.textContent||""));
  if(bt){const r=bt.getBoundingClientRect(); out.backToTop={x:Math.round(r.x),w:Math.round(r.width),align:getComputedStyle(bt).textAlign};}
  const bc=document.querySelector(".breadcrumbs");
  if(bc){const r=bc.getBoundingClientRect(); out.breadcrumbs={x:Math.round(r.x),w:Math.round(r.width)};}
  return out;
}),null,1));
await b.close(); s.close();
