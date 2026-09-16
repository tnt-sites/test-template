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
await p.goto(`http://localhost:${s.address().port}/${PAGE}`,{waitUntil:"networkidle"}); await p.waitForTimeout(1200);
console.log(JSON.stringify(await p.evaluate(()=>{
  const o={};
  const g=(sel,label,props)=>{const e=document.querySelector(sel); if(!e){o[label]="—";return;}
    const cs=getComputedStyle(e); const r=e.getBoundingClientRect();
    const out={box:`${Math.round(r.width)}x${Math.round(r.height)} @${Math.round(r.x)}`};
    for(const k of props) out[k]=cs[k];
    return o[label]=out;};
  g("h1 span","h1 span",["color","fontSize","fontWeight","display"]);
  g(".divider","divider (h2 rule)",["backgroundColor","height","width","margin","borderBottom"]);
  g(".side-bar","sidebar",["backgroundColor","padding"]);
  g(".side-bar .related-topics","sidebar panel",["backgroundColor","padding"]);
  g(".side-bar form, .side-bar input","sidebar search",["display","width"]);
  g(".call-out","call-out",["backgroundColor","maxWidth","borderRadius","padding","position"]);
  g(".bullet-list","bullet list",["listStyleType","paddingLeft"]);
  g(".bullet-list li","bullet li",["listStyleType","paddingLeft"]);
  g(".definition-flex","definition flex",["display","flexWrap"]);
  g(".definitions .col","definition col",["width","flexBasis"]);
  g(".faq-section","faq",["backgroundColor"]);
  // is the FAQ an accordion?
  o.faqDetails = document.querySelectorAll(".faq-section details").length;
  o.faqLinks = document.querySelectorAll(".faq-section a").length;
  o.faqQuestions = document.querySelectorAll(".faq-section .questions").length;
  // back-to-top + breadcrumbs
  o.backToTop = !!document.body.textContent.match(/Back to top of/);
  o.breadcrumbs = document.querySelectorAll(".breadcrumbs,.breadcrumb").length;
  // call-out tail?
  const co=document.querySelector(".call-out");
  if(co){const a=getComputedStyle(co,"::after"), be=getComputedStyle(co,"::before");
    o.calloutAfter={content:a.content,border:a.borderTop,w:a.width,h:a.height,pos:a.position};
    o.calloutBefore={content:be.content,border:be.borderTop,w:be.width,h:be.height};}
  return o;
}),null,1));
await b.close(); s.close();
