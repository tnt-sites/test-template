import { chromium } from "playwright";
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:900}});
await p.goto(process.argv[2],{waitUntil:"networkidle"}); await p.waitForTimeout(1200);
console.log(JSON.stringify(await p.evaluate(()=>{
  const dl=document.querySelector(".definition-list");
  if(!dl) return "no dl";
  const kids=[...dl.children].slice(0,4).map(k=>{const r=k.getBoundingClientRect();
    return {tag:k.tagName.toLowerCase(),w:Math.round(r.width),x:Math.round(r.x),d:getComputedStyle(k).display};});
  return {cols:getComputedStyle(dl).gridTemplateColumns, kids};
})));
await b.close();
