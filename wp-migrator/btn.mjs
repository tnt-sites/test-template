import { chromium } from 'playwright';
const SC='/private/tmp/claude-501/-Users-tharvey-Work-CloudCannon-northcounty/fdb7a81a-57ec-4eee-aadb-b03a080cf26e/scratchpad';
const b=await chromium.launch();
const p=await b.newPage({viewport:{width:1440,height:1100}});
await p.goto('http://localhost:4321/vista-ca/complete-health-dentistry-membership-club/',{waitUntil:'domcontentloaded',timeout:60000});
await p.evaluate(async()=>{for(let y=0;y<document.body.scrollHeight;y+=350){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,120));}window.scrollTo(0,0);});
await p.waitForTimeout(3000);
console.log(JSON.stringify(await p.evaluate(()=>{
  const row=document.querySelector('.image-row');
  const btns=[...row.querySelectorAll('.ir-button')].map(a=>{
    const r=a.getBoundingClientRect(); const s=getComputedStyle(a);
    return {text:a.textContent.trim(),href:a.getAttribute('href'),target:a.target,
      x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),
      bg:s.backgroundColor,color:s.color,radius:s.borderRadius,font:s.fontSize+'/'+s.fontWeight};
  });
  const imgs=[...row.querySelectorAll('img')].map(e=>{const r=e.getBoundingClientRect();
    return {w:Math.round(r.width),h:Math.round(r.height),bottom:Math.round(r.bottom)};});
  return {nBtns:btns.length,btns,imgs,pageH:document.body.scrollHeight};
}),null,1));
const el=await p.$('.image-row'); await el.screenshot({path:`${SC}/plan-btns.png`});
await b.close();
