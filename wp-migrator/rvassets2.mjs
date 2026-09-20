import { chromium } from 'playwright';
const b=await chromium.launch();
const p=await b.newPage({viewport:{width:1440,height:1000}});
await p.goto('https://www.ultimatesmiles.com/reviews/',{waitUntil:'domcontentloaded',timeout:60000});
await p.waitForTimeout(6000);
console.log(JSON.stringify(await p.evaluate(()=>{
  const s=document.querySelector('.testimonials-slider');
  const real=[...s.querySelectorAll('.slick-slide')].filter(e=>!e.classList.contains('slick-cloned'));
  const slide=real[1];
  const quote=slide.querySelector('.col.l3 img');
  const stars=[...slide.querySelectorAll('.rating-star img')];
  const wrap=slide.querySelector('.testimonials-wrap')||slide.closest('.testimonials-wrap')||slide;
  const dotsUl=document.querySelector('.slick-dots');
  const kids=[...dotsUl.children].map(c=>({tag:c.tagName,cls:c.className,html:c.innerHTML.slice(0,60)}));
  const probe=(el,which)=>{if(!el)return null;const c=which?getComputedStyle(el,which):getComputedStyle(el);
    return {content:c.content.slice(0,14),color:c.color,bg:c.backgroundColor,w:c.width,h:c.height,
            opacity:c.opacity,fontSize:c.fontSize,radius:c.borderRadius};};
  const act=dotsUl.querySelector('.slick-active')||dotsUl.children[0];
  const idle=[...dotsUl.children].find(c=>!c.classList.contains('slick-active'));
  return {
    quoteSrc:quote?quote.src:null, quoteAlt:quote?quote.alt:null,
    starSrcs:[...new Set(stars.map(e=>e.src))], nStars:stars.length,
    wrapShadow:getComputedStyle(wrap).boxShadow,
    dotKids:kids.slice(0,3),
    activeSelf:probe(act,null), activeBefore:probe(act,'::before'),
    idleSelf:probe(idle,null), idleBefore:probe(idle,'::before'),
    activeBtn:probe(act?.querySelector('button'),null),
    activeBtnBefore:probe(act?.querySelector('button'),'::before')
  };
}),null,1));
await b.close();
