import { chromium } from "playwright";
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:900}});
await p.goto(process.argv[2],{waitUntil:"networkidle"}); await p.waitForTimeout(1200);
console.log(JSON.stringify(await p.evaluate(()=>{
  const o={};
  const m=(sel,l)=>{const e=document.querySelector(sel); if(!e){o[l]="—";return;}
    const r=e.getBoundingClientRect(); const cs=getComputedStyle(e);
    o[l]={w:Math.round(r.width),x:Math.round(r.x),maxw:cs.maxWidth,pad:cs.paddingLeft,display:cs.display};};
  m("main .section","first section");
  m("main .section .inner-content","inner-content");
  m("main p","paragraph");
  m(".definition-list","definition-list");
  m("dl","dl");
  o.contentXl = getComputedStyle(document.documentElement).getPropertyValue("--content-width-xl");
  return o;
}),null,1));
await b.close();
