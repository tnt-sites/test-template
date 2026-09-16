import { chromium } from "playwright";
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:900}});
await p.goto(process.argv[2],{waitUntil:"networkidle"}); await p.waitForTimeout(1200);
console.log(JSON.stringify(await p.evaluate(()=>{
  const out=[];
  document.querySelectorAll("main ul").forEach((ul,i)=>{
    if(i>3) return;
    const li=ul.querySelector("li"); if(!li) return;
    const cs=getComputedStyle(li), m=getComputedStyle(li,"::marker"), be=getComputedStyle(li,"::before");
    const r=li.getBoundingClientRect();
    out.push({ulClass:ul.className.slice(0,30),
      inFaq:!!li.closest(".faq-card"), inSide:!!li.closest(".cws-side"),
      display:cs.display, listStyleType:cs.listStyleType, listStylePosition:cs.listStylePosition,
      marL:cs.marginLeft, padL:cs.paddingLeft, overflow:cs.overflow,
      markerColor:m.color, markerContent:m.content, markerFont:m.fontFamily?.slice(0,20),
      beforeContent:be.content, x:Math.round(r.x), text:(li.textContent||"").trim().slice(0,22)});
  });
  return out;
}),null,1));
await b.close();
