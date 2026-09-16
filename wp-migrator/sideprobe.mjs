import { chromium } from "playwright";
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:900}});
await p.goto(process.argv[2],{waitUntil:"networkidle"}); await p.waitForTimeout(1200);
console.log(JSON.stringify(await p.evaluate(()=>{
  const s=document.querySelector(".cws-side"), m=document.querySelector(".cws-main");
  const box=e=>e?{w:Math.round(e.getBoundingClientRect().width),x:Math.round(e.getBoundingClientRect().x)}:"—";
  return {main:box(m), side:box(s), sideText:(s?.textContent||"").trim().slice(0,60)};
}),null,1));
await b.close();
