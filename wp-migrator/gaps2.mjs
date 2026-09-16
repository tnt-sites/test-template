import { chromium } from "playwright";
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:1000}});
await p.goto(process.argv[2],{waitUntil:"networkidle"}); await p.waitForTimeout(1500);
console.log(JSON.stringify(await p.evaluate(()=>{
  const els=[...document.querySelectorAll(".cws-main .custom-section, .cws-main .page-banner")];
  let prev=null; const out=[];
  for(const e of els){
    const cs=getComputedStyle(e); const r=e.getBoundingClientRect();
    const h=e.querySelector("h1,h2,h3,h4,h5");
    const top=Math.round(r.top+window.scrollY), bottom=Math.round(r.bottom+window.scrollY);
    out.push({label:(h?.textContent||"").trim().slice(0,32),
      mT:cs.marginTop, mB:cs.marginBottom, gap: prev===null?null:top-prev,
      bg:cs.backgroundColor});
    prev=bottom;
  }
  return out;
}),null,1));
await b.close();
