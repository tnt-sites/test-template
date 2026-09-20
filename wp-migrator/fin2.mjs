import { chromium } from 'playwright';
const b=await chromium.launch();
for(const w of [390,768,1440]){
  const p=await b.newPage({viewport:{width:w,height:900}});
  await p.goto('http://localhost:4322/reviews/',{waitUntil:'domcontentloaded',timeout:60000});
  await p.waitForTimeout(3500);
  console.log(w, JSON.stringify(await p.evaluate(()=>{
    const c=document.querySelector('.reviews-carousel');
    if(!c) return {err:'no carousel'};
    const card=c.querySelector('.rc-card');
    const q=c.querySelector('.rc-quote img');
    const st=[...c.querySelectorAll('.rc-slide')[0].querySelectorAll('.rc-stars img')];
    return {card:card?Math.round(card.getBoundingClientRect().width):null,
      quote:q?Math.round(q.getBoundingClientRect().width):null,
      starRows:new Set(st.map(e=>Math.round(e.getBoundingClientRect().y))).size,
      docW:document.documentElement.scrollWidth, clientW:document.documentElement.clientWidth};
  })));
  await p.close();
}
await b.close();
