import { chromium } from 'playwright';
const b=await chromium.launch();
const p=await b.newPage({viewport:{width:1440,height:1000}});
await p.goto('https://www.ultimatesmiles.com/',{waitUntil:'domcontentloaded',timeout:60000});
await p.evaluate(async()=>{for(let y=0;y<1200;y+=200){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,200));}window.scrollTo(0,0);});
await p.waitForTimeout(4000);
console.log(JSON.stringify(await p.evaluate(()=>{
  const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).display!=='none';};
  const box=e=>{const r=e.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y+scrollY),w:Math.round(r.width),h:Math.round(r.height)};};
  const big=[...document.querySelectorAll('img')].filter(vis).filter(e=>e.getBoundingClientRect().width>500)
    .map(e=>({...box(e),src:(e.currentSrc||e.src).split('/').pop().slice(0,50)}));
  // hero heading = the one above the fold
  const heads=[...document.querySelectorAll('h1,h2,h3,.title,div')].filter(vis)
    .filter(e=>/Exceptional Dentistry/i.test(e.textContent)&&e.textContent.length<120)
    .map(e=>{const s=getComputedStyle(e);return {...box(e),tag:e.tagName,cls:(e.className||'').toString().slice(0,34),
      size:s.fontSize,weight:s.fontWeight,align:s.textAlign,color:s.color,bg:s.backgroundColor,family:s.fontFamily.split(',')[0]};});
  const btns=[...document.querySelectorAll('a')].filter(vis).filter(e=>/Call Now|Book Now/i.test(e.textContent))
    .map(e=>{const s=getComputedStyle(e);return {t:e.textContent.trim(),...box(e),bg:s.backgroundColor,radius:s.borderRadius,href:e.getAttribute('href')};});
  // element carrying the hero background
  const bgs=[...document.querySelectorAll('div,section')].filter(vis).filter(e=>{
    const s=getComputedStyle(e); const r=e.getBoundingClientRect();
    return s.backgroundImage&&s.backgroundImage!=='none'&&r.width>1000&&r.height>300;})
    .slice(0,3).map(e=>({...box(e),cls:(e.className||'').toString().slice(0,40),
      img:getComputedStyle(e).backgroundImage.slice(0,110),size:getComputedStyle(e).backgroundSize,pos:getComputedStyle(e).backgroundPosition}));
  return {bigImgs:big.slice(0,3),heroHeads:heads.slice(0,3),btns,bgElems:bgs};
}),null,1));
await b.close();
