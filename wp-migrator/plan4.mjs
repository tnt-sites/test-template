import { chromium } from 'playwright';
const b=await chromium.launch();
const p=await b.newPage({viewport:{width:1440,height:1000}});
await p.goto('https://www.ultimatesmiles.com/complete-health-dentistry-membership-club/',{waitUntil:'domcontentloaded',timeout:60000});
await p.waitForTimeout(5000);
console.log(JSON.stringify(await p.evaluate(()=>{
  const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).display!=='none';};
  // every link on the page that points at a pdf, or says enroll
  const all=[...document.querySelectorAll('a')].filter(vis).filter(a=>
    /\.pdf/i.test(a.href)||/enroll/i.test(a.textContent));
  return all.map(a=>{
    const r=a.getBoundingClientRect(); const s=getComputedStyle(a);
    return {text:a.textContent.trim().slice(0,30),href:a.href,
      x:Math.round(r.x),y:Math.round(r.y+scrollY),w:Math.round(r.width),h:Math.round(r.height),
      bg:s.backgroundColor,color:s.color,radius:s.borderRadius,border:s.border,
      font:s.fontSize+'/'+s.fontWeight,pad:s.padding,transform:s.textTransform,
      family:s.fontFamily.split(',')[0],target:a.target,
      parentCls:(a.parentElement.className||'').toString().slice(0,40)};
  });
}),null,1));
await b.close();
