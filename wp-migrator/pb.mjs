import { chromium } from "playwright";
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:1000}});
await p.goto(process.argv[2],{waitUntil:"networkidle"}); await p.waitForTimeout(1500);
console.log(JSON.stringify(await p.evaluate(()=>{
  const grid=document.querySelector(".pb-grid");
  const paras=[...document.querySelectorAll(".pb-intro p")];
  const loc=document.querySelector(".pb-location");
  const cols=[...(grid?.children||[])].map(c=>{const r=c.getBoundingClientRect();
    return {cls:c.className,h:Math.round(r.height),y:Math.round(r.top+window.scrollY)};});
  return {align:grid?getComputedStyle(grid).alignItems:"—",
    paragraphs:paras.length,
    firstPara:(paras[0]?.textContent||"").trim().slice(0,40),
    lastPara:(paras.at(-1)?.textContent||"").trim().slice(0,40),
    locationColor:loc?getComputedStyle(loc).color:"—",
    cols};
}),null,1));
await b.close();
