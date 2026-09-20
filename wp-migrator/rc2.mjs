import { chromium } from 'playwright';
const SC='/private/tmp/claude-501/-Users-tharvey-Work-CloudCannon-northcounty/fdb7a81a-57ec-4eee-aadb-b03a080cf26e/scratchpad';
const b=await chromium.launch();
const p=await b.newPage({viewport:{width:1440,height:1100}});
const errs=[]; p.on('pageerror',e=>errs.push(e.message.slice(0,100)));
await p.goto('http://localhost:4322/reviews/',{waitUntil:'domcontentloaded',timeout:60000});
await p.evaluate(async()=>{for(let y=0;y<document.body.scrollHeight;y+=350){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,130));}window.scrollTo(0,0);});
await p.waitForTimeout(4000);
console.log(JSON.stringify(await p.evaluate(()=>{
  const c=document.querySelector('.reviews-carousel');
  if(!c) return {err:'missing'};
  const sl=[...c.querySelectorAll('.rc-slide')];
  const card=sl[0].querySelector('.rc-card');
  const cs=getComputedStyle(card), af=getComputedStyle(card,'::after');
  const q=sl[0].querySelector('.rc-quote img');
  const st=[...sl[0].querySelectorAll('.rc-stars img')];
  const v=sl[0].querySelector('iframe');
  const dot=c.querySelector('.rc-indicator[data-selected="true"]');
  const ds=dot?getComputedStyle(dot):null;
  const r=e=>{const b=e.getBoundingClientRect();return {w:Math.round(b.width),h:Math.round(b.height)};};
  return {n:sl.length, slide:r(sl[0]), card:r(card), bg:cs.backgroundColor, pad:cs.padding, radius:cs.borderRadius,
    tail:{content:af.content,borderTop:af.borderTopColor,w:af.borderLeftWidth,left:af.left,bottom:af.bottom},
    quote:q?r(q):null, nStars:st.length, star:st[0]?r(st[0]):null, video:v?r(v):null,
    dotColor:ds?ds.color:null, dotOpacity:ds?ds.opacity:null,
    pitch:sl.length>1?Math.round(sl[1].getBoundingClientRect().x-sl[0].getBoundingClientRect().x):null,
    pageH:document.body.scrollHeight};
}),null,1));
console.log('pageerrors:',errs.length?errs:'none');
const el=await p.$('.reviews-carousel'); await el.screenshot({path:`${SC}/rc2.png`});
await b.close();
