import { chromium } from 'playwright';
const SC='/private/tmp/claude-501/-Users-tharvey-Work-CloudCannon-northcounty/fdb7a81a-57ec-4eee-aadb-b03a080cf26e/scratchpad';
const b=await chromium.launch();
const p=await b.newPage({viewport:{width:1440,height:1100}});
await p.goto('http://localhost:4321/reviews/',{waitUntil:'domcontentloaded',timeout:60000});
await p.evaluate(async()=>{for(let y=0;y<document.body.scrollHeight;y+=350){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,130));}window.scrollTo(0,0);});
await p.waitForTimeout(4000);
console.log(JSON.stringify(await p.evaluate(()=>{
  const c=document.querySelector('.reviews-carousel');
  if(!c) return {err:'no carousel'};
  const slide=c.querySelectorAll('.rc-slide')[1]||c.querySelector('.rc-slide');
  const li=slide.querySelector('.rc-stars li');
  const bf=getComputedStyle(li,'::before'), mk=getComputedStyle(li,'::marker');
  const q=slide.querySelector('.rc-quote'), body=slide.querySelector('.rc-body');
  const qr=q.getBoundingClientRect(), br=body.getBoundingClientRect();
  const dot=c.querySelector('.rc-indicator'), act=c.querySelector('.rc-indicator[data-selected="true"]');
  const dr=dot.getBoundingClientRect(), ds=getComputedStyle(dot), as=act?getComputedStyle(act):null;
  const st=[...slide.querySelectorAll('.rc-stars img')];
  return {
    starBefore:{content:bf.content,display:bf.display},
    starMarker:{content:mk.content},
    starRows:new Set(st.map(e=>Math.round(e.getBoundingClientRect().y))).size,
    quoteCentre:Math.round(qr.y+qr.height/2), bodyCentre:Math.round(br.y+br.height/2),
    dot:{w:Math.round(dr.width),h:Math.round(dr.height),bg:ds.backgroundColor},
    activeBg:as?as.backgroundColor:null,
    pageH:document.body.scrollHeight};
}),null,1));
const el=await p.$('.reviews-carousel'); await el.screenshot({path:`${SC}/rc4.png`});
await b.close();
