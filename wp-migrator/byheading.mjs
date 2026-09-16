import { chromium } from "playwright";
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:1000}});
await p.goto(process.argv[2],{waitUntil:"networkidle"}); await p.waitForTimeout(1500);
await p.evaluate(async()=>{await new Promise(r=>{let y=0;const t=setInterval(()=>{window.scrollTo(0,y);y+=800;
  if(y>document.body.scrollHeight){clearInterval(t);window.scrollTo(0,0);r();}},40);});});
await p.waitForTimeout(600);
const handle = await p.evaluateHandle((needle)=>{
  const h=[...document.querySelectorAll("h1,h2,h3,h4,h5")].find(e=>e.textContent.trim().startsWith(needle));
  return h ? h.closest(".custom-section") : null;
}, process.argv[3]);
const el = handle.asElement();
if(el) await el.screenshot({path:process.argv[4]}); else console.log("not found");
await b.close();
