import { chromium } from "playwright";
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:1000}});
await p.goto(process.argv[2],{waitUntil:"networkidle",timeout:60000}); await p.waitForTimeout(2500);
console.log(JSON.stringify(await p.evaluate(()=>{
  const row=document.querySelector(".image-row");
  const imgs=[...(row?.querySelectorAll("img")||[])];
  const bub=document.querySelector(".callout-bubble");
  return {row: row?{w:Math.round(row.getBoundingClientRect().width),
      cols:getComputedStyle(row).gridTemplateColumns,
      count:imgs.length,
      first:imgs[0]?{w:Math.round(imgs[0].getBoundingClientRect().width),h:Math.round(imgs[0].getBoundingClientRect().height)}:"—"}:"no image-row",
    bubble: bub?{w:Math.round(bub.getBoundingClientRect().width),
      radius:getComputedStyle(bub).borderRadius,align:getComputedStyle(bub).textAlign}:"—",
    docHeight: document.body.scrollHeight};
}),null,1));
await b.close();
