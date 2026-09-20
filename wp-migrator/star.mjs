import { chromium } from 'playwright';
const b=await chromium.launch();
const p=await b.newPage({viewport:{width:1440,height:1100}});
await p.goto('http://localhost:4322/reviews/',{waitUntil:'domcontentloaded',timeout:60000});
await p.waitForTimeout(3500);
console.log(JSON.stringify(await p.evaluate(()=>{
  const img=document.querySelector('.rc-stars img');
  const li=img.closest('li');
  const cs=getComputedStyle(img);
  return {outer:img.outerHTML.slice(0,240),
    w:cs.width,h:cs.height,maxW:cs.maxWidth,objFit:cs.objectFit,display:cs.display,
    liW:getComputedStyle(li).width, ulDisplay:getComputedStyle(img.closest('ul')).display,
    parentTag:img.parentElement.tagName, parentCls:img.parentElement.className};
}),null,1));
await b.close();
