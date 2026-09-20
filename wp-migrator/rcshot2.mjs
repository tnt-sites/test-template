import { chromium } from 'playwright';
const SC='/private/tmp/claude-501/-Users-tharvey-Work-CloudCannon-northcounty/fdb7a81a-57ec-4eee-aadb-b03a080cf26e/scratchpad';
const b=await chromium.launch();
const p=await b.newPage({viewport:{width:1440,height:1100}});
await p.goto('http://localhost:4322/reviews/',{waitUntil:'domcontentloaded',timeout:60000});
await p.evaluate(async()=>{for(let y=0;y<document.body.scrollHeight;y+=350){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,130));}window.scrollTo(0,0);});
await p.waitForTimeout(4500);
const el=await p.$('.reviews-carousel'); await el.screenshot({path:`${SC}/rc3.png`});
console.log(JSON.stringify(await p.evaluate(()=>{
  const c=document.querySelector('.reviews-carousel');
  const st=[...c.querySelectorAll('.rc-slide')[1].querySelectorAll('.rc-stars img')];
  const ul=c.querySelector('.rc-stars');
  const r=ul.getBoundingClientRect();
  return {starsRow:{w:Math.round(r.width),h:Math.round(r.height)},
    starYs:[...new Set(st.map(e=>Math.round(e.getBoundingClientRect().y)))],
    pageH:document.body.scrollHeight};
})));
await b.close();
