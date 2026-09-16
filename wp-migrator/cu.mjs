import { chromium } from "playwright";
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:1000}});
await p.goto(process.argv[2],{waitUntil:"networkidle",timeout:60000}); await p.waitForTimeout(2500);
console.log(JSON.stringify(await p.evaluate(()=>{
  const h=[...document.querySelectorAll("h2,h3")].find(e=>/Contact Us/.test(e.textContent||""));
  const sec=h?.closest(".custom-section");
  if(!sec) return "no contact section";
  return [...sec.querySelectorAll("a")].map(a=>({
    text:(a.textContent||"").trim().slice(0,40), href:a.getAttribute("href"),
    deco:getComputedStyle(a).textDecorationLine}));
}),null,1));
await b.close();
