import { chromium } from "playwright";
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:900}});
await p.goto(process.argv[2],{waitUntil:"networkidle"}); await p.waitForTimeout(1200);
console.log(JSON.stringify(await p.evaluate(()=>{
  const g=e=>{if(!e) return "—"; const cs=getComputedStyle(e); const r=e.getBoundingClientRect();
    return {color:cs.color,deco:cs.textDecorationLine,marker:cs.listStyleType,
      padL:cs.paddingLeft,marL:cs.marginLeft,x:Math.round(r.x),w:Math.round(r.width)};};
  const mk=e=>{if(!e) return "—"; const m=getComputedStyle(e,"::marker"); return {color:m.color,content:m.content};};
  const out={};
  const mainUl=document.querySelector(".cws-main .list ul, .cws-main ul");
  out.contentLi=g(mainUl?.querySelector("li")); out.contentMarker=mk(mainUl?.querySelector("li"));
  out.contentLink=g(document.querySelector(".cws-main p a"));
  const faq=document.querySelector(".faq-card");
  out.faqLi=g(faq?.querySelector("li")); out.faqMarker=mk(faq?.querySelector("li"));
  out.faqLink=g(faq?.querySelector("li a"));
  out.sideLink=g(document.querySelector(".cws-side li a"));
  const pfn=document.querySelector(".page-footer-nav");
  out.footerNav=pfn?{x:Math.round(pfn.getBoundingClientRect().x),w:Math.round(pfn.getBoundingClientRect().width)}:"—";
  out.preFooterCount=document.querySelectorAll(".pre-footer").length;
  return out;
}),null,1));
await b.close();
