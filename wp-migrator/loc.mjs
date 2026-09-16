import { chromium } from "playwright";
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:1000}});
await p.goto(process.argv[2],{waitUntil:"networkidle"}); await p.waitForTimeout(1500);
console.log(JSON.stringify(await p.evaluate(()=>{
  const g=(sel)=>{const e=document.querySelector(sel); if(!e) return "—";
    const cs=getComputedStyle(e); const r=e.getBoundingClientRect();
    return {size:cs.fontSize,weight:cs.fontWeight,x:Math.round(r.x),w:Math.round(r.width),
      text:(e.textContent||"").trim().slice(0,26)};};
  return {name:g(".pb-name"), location:g(".pb-location"), h1:g("h1.pb-title"),
    intro:g(".pb-intro p"), iframeX:Math.round((document.querySelector(".page-banner iframe")||{getBoundingClientRect:()=>({x:0})}).getBoundingClientRect().x)};
}),null,1));
await b.close();
