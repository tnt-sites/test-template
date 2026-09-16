import { chromium } from "playwright";
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:1000}});
await p.goto(process.argv[2],{waitUntil:"networkidle",timeout:60000}); await p.waitForTimeout(2500);
console.log(JSON.stringify(await p.evaluate(()=>{
  const w=document.querySelector(".embed-wrapper"), i=w?.querySelector("iframe");
  const g=e=>{if(!e) return "—"; const r=e.getBoundingClientRect(); const cs=getComputedStyle(e);
    return {w:Math.round(r.width),h:Math.round(r.height),ar:cs.aspectRatio,cls:e.className};};
  // is there dead space after the video inside its section?
  const sec=w?.closest(".custom-section");
  return {wrapper:g(w), iframe:g(i),
    sectionH: sec?Math.round(sec.getBoundingClientRect().height):0};
}),null,1));
await b.close();
