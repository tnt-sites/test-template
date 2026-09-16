import { chromium } from "playwright";
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:1000}});
await p.goto(process.argv[2],{waitUntil:"networkidle"}); await p.waitForTimeout(3000);
console.log(JSON.stringify(await p.evaluate(()=>{
  const f=document.querySelector(".liine-form");
  const i=document.querySelector(".liine-form iframe");
  if(!f||!i) return "no standalone form";
  const fr=f.getBoundingClientRect(), ir=i.getBoundingClientRect();
  return {section:{h:Math.round(fr.height)}, iframe:{h:Math.round(ir.height), attr:i.getAttribute("style")?.match(/height:\s*([\d.]+px)/)?.[1]},
    clipped: Math.round(ir.bottom) > Math.round(fr.bottom)+2};
}),null,1));
await b.close();
