import { chromium } from "playwright";
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:900}});
await p.goto(process.argv[2],{waitUntil:"networkidle"}); await p.waitForTimeout(1200);
console.log(JSON.stringify(await p.evaluate(()=>{
  const out={};
  const bub=document.querySelectorAll(".callout-bubble");
  out.bubbles=[...bub].map(e=>{
    const t=e.querySelector("p,h2,h3,h5");
    return {bg:getComputedStyle(e).backgroundColor,
      textColor:t?getComputedStyle(t).color:"—", text:(t?.textContent||"").trim().slice(0,40)};
  });
  const dl=document.querySelector(".definition-list");
  if(dl){const dt=dl.querySelector("dt"), dd=dl.querySelector("dd");
    out.definitions={panelBg:getComputedStyle(dl.closest(".section")||dl).backgroundColor,
      dt:dt?getComputedStyle(dt).color:"—", dd:dd?getComputedStyle(dd).color:"—"};}
  return out;
}),null,1));
await b.close();
