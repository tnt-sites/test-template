import { chromium } from 'playwright';
const b=await chromium.launch();
const out={};
for(const [k,url,sel] of [
  ['src','https://www.ultimatesmiles.com/reviews/','.slick-dots'],
  ['built','http://localhost:4322/reviews/','.rc-indicators']]){
  const p=await b.newPage({viewport:{width:1440,height:1000}});
  await p.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
  await p.waitForTimeout(5000);
  out[k]=await p.evaluate((sel)=>{
    const ul=document.querySelector(sel); if(!ul) return {err:'none'};
    const kids=[...ul.children];
    const box=e=>{const r=e.getBoundingClientRect();return {x:Math.round(r.x),w:Math.round(r.width),h:Math.round(r.height)};};
    const r=ul.getBoundingClientRect();
    return {rowW:Math.round(r.width),n:kids.length,
      first:box(kids[0]), second:kids[1]?box(kids[1]):null,
      pitch:kids[1]?Math.round(kids[1].getBoundingClientRect().x-kids[0].getBoundingClientRect().x):null};
  },sel);
  await p.close();
}
console.log(JSON.stringify(out,null,1));
await b.close();
