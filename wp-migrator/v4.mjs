import { chromium } from 'playwright';
const b=await chromium.launch();
const p=await b.newPage({viewport:{width:1440,height:1100}});
await p.goto('http://localhost:4321/reviews/',{waitUntil:'domcontentloaded',timeout:60000});
await p.waitForTimeout(3500);
console.log(JSON.stringify(await p.evaluate(()=>{
  const c=document.querySelector('.reviews-carousel');
  const dots=[...c.querySelectorAll('.rc-indicator')];
  const idle=dots.find(d=>d.getAttribute('data-selected')!=='true');
  const act=dots.find(d=>d.getAttribute('data-selected')==='true');
  const m=e=>{const r=e.getBoundingClientRect();const s=getComputedStyle(e);
    return {w:Math.round(r.width),h:Math.round(r.height),bg:s.backgroundColor,radius:s.borderRadius};};
  return {n:dots.length, idle:m(idle), active:m(act),
    pitch:Math.round(dots[1].getBoundingClientRect().x-dots[0].getBoundingClientRect().x)};
}),null,1));
await b.close();
