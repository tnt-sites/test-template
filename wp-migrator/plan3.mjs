import { chromium } from 'playwright';
const b=await chromium.launch();
const p=await b.newPage({viewport:{width:1440,height:1000}});
await p.goto('https://www.ultimatesmiles.com/complete-health-dentistry-membership-club/',{waitUntil:'domcontentloaded',timeout:60000});
await p.waitForTimeout(5000);
console.log(JSON.stringify(await p.evaluate(()=>{
  const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).display!=='none';};
  const h=[...document.querySelectorAll('h1,h2,h3')].find(e=>/choose the plan/i.test(e.textContent));
  const sec=h.closest('section')||h.parentElement;
  const cards=[...sec.querySelectorAll('div')].filter(e=>{const r=e.getBoundingClientRect();
    return vis(e)&&Math.abs(r.width-293)<6&&r.height>300;});
  return cards.map(c=>{
    const img=c.querySelector('img');
    const links=[...c.parentElement.querySelectorAll('a')].filter(vis).map(a=>{
      const r=a.getBoundingClientRect(); const s=getComputedStyle(a);
      return {text:a.textContent.trim().slice(0,30),href:a.href,
        w:Math.round(r.width),h:Math.round(r.height),
        bg:s.backgroundColor,color:s.color,radius:s.borderRadius,
        font:s.fontSize+'/'+s.fontWeight,pad:s.padding,transform:s.textTransform,
        family:s.fontFamily.split(',')[0]};
    });
    return {img:img?img.src.split('/').pop():null, links};
  });
}),null,1));
await b.close();
