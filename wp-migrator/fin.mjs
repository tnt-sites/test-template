import { chromium } from 'playwright';
const b=await chromium.launch();
for(const [k,u] of [['src','https://www.ultimatesmiles.com/reviews/'],['built','http://localhost:4322/reviews/']]){
  const p=await b.newPage({viewport:{width:1440,height:1000}});
  await p.goto(u,{waitUntil:'domcontentloaded',timeout:60000});
  await p.waitForTimeout(6000);
  console.log(k,'pageH',await p.evaluate(()=>document.body.scrollHeight));
  await p.close();
}
for(const w of [390,768,1440]){
  const p=await b.newPage({viewport:{width:w,height:900}});
  await p.goto('http://localhost:4322/reviews/',{waitUntil:'domcontentloaded',timeout:60000});
  await p.waitForTimeout(3500);
  console.log(w, JSON.stringify(await p.evaluate(()=>{
    const c=document.querySelector('.reviews-carousel');
    const card=c.querySelector('.rc-card'); const q=c.querySelector('.rc-quote img');
    const st=[...c.querySelectorAll('.rc-slide')[0].querySelectorAll('.rc-stars img')];
    return {card:Math.round(card.getBoundingClientRect().width),
      quote:q?Math.round(q.getBoundingClientRect().width):null,
      starRows:new Set(st.map(e=>Math.round(e.getBoundingClientRect().y))).size};
  })));
  await p.close();
}
await b.close();
