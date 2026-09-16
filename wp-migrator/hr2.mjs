import { chromium } from "playwright";
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:1000}});
await p.goto(process.argv[2],{waitUntil:"networkidle",timeout:60000}); await p.waitForTimeout(2500);
console.log(JSON.stringify(await p.evaluate(()=>{
  const row=document.querySelector(".image-row");
  const sec=row?.closest(".custom-section");
  if(!sec) return "no section";
  return [...sec.querySelectorAll(".divider")].map(d=>{
    const r=d.getBoundingClientRect(); const cs=getComputedStyle(d);
    const hr=d.querySelector("hr");
    const hrs=hr?getComputedStyle(hr):null;
    return {w:Math.round(r.width),h:Math.round(r.height),margin:cs.margin,
      hrBorder:hrs?hrs.borderTop:"—", hrH:hr?Math.round(hr.getBoundingClientRect().height):0};
  });
}),null,1));
await b.close();
