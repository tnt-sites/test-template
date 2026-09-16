import { chromium } from "playwright";
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:1000}});
await p.goto(process.argv[2],{waitUntil:"networkidle",timeout:60000}); await p.waitForTimeout(2500);
console.log(JSON.stringify(await p.evaluate(()=>{
  const mark=document.querySelector(".yelp-mark");
  const row=document.querySelector(".image-row");
  const rowSec=row?.closest(".custom-section");
  return {
    yelpMark: mark?{w:Math.round(mark.getBoundingClientRect().width),
      h:Math.round(mark.getBoundingClientRect().height),
      mask:getComputedStyle(mark).maskImage.slice(0,44),
      bg:getComputedStyle(mark).backgroundColor}:"missing",
    imageRowSectionBg: rowSec?getComputedStyle(rowSec).backgroundColor:"—",
    docHeight: document.body.scrollHeight};
}),null,1));
await b.close();
