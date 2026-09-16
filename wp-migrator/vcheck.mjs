import { chromium } from "playwright";
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:1000}});
await p.goto(process.argv[2],{waitUntil:"networkidle",timeout:60000}); await p.waitForTimeout(4000);
console.log(JSON.stringify(await p.evaluate(()=>{
  const w=document.querySelector(".embed-wrapper"), i=w?.querySelector("iframe");
  if(!w) return "no embed-wrapper";
  const wr=w.getBoundingClientRect(), ir=i?.getBoundingClientRect();
  const sec=w.closest(".custom-section");
  return {wrapper:{w:Math.round(wr.width),h:Math.round(wr.height),
      ar:getComputedStyle(w).aspectRatio},
    iframe: i?{w:Math.round(ir.width),h:Math.round(ir.height),src:i.getAttribute("src")}:"missing",
    sectionH: sec?Math.round(sec.getBoundingClientRect().height):0};
}),null,1));
await b.close();
