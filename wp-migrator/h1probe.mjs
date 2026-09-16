import { chromium } from "playwright";
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:900}});
await p.goto(process.argv[2],{waitUntil:"networkidle"}); await p.waitForTimeout(1000);
console.log(JSON.stringify(await p.evaluate(()=>{
  const n=document.querySelector(".pb-name"), l=document.querySelector(".pb-location");
  const g=e=>e?{size:getComputedStyle(e).fontSize,weight:getComputedStyle(e).fontWeight}:"—";
  return {name:g(n), location:g(l)};
})));
await b.close();
