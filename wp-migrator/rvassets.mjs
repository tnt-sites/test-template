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
  const dotsUl=document.querySelector('.slick-dots');
  const lis=[...dotsUl.querySelectorAll('li')];
  const readDot=(li)=>{const btn=li.querySelector('button')||li;
    const bs=getComputedStyle(btn), bb=getComputedStyle(btn,'::before');
    return {liCls:li.className,bg:bs.backgroundColor,w:bs.width,h:bs.height,radius:bs.borderRadius,
      beforeContent:bb.content.slice(0,12),beforeColor:bb.color,beforeBg:bb.backgroundColor,
      beforeOpacity:bb.opacity,beforeSize:bb.fontSize};};
  const wrap=slide.querySelector('.testimonials-wrap');
  const ws=getComputedStyle(wrap);
  return {
    quoteSrc:quote?quote.src:null,
    starSrcs:[...new Set(stars.map(e=>e.src))],
    nStars:stars.length,
    wrapShadow:ws.boxShadow,
    dotActive:readDot(lis.find(l=>l.classList.contains('slick-active'))),
    dotIdle:readDot(lis.find(l=>!l.classList.contains('slick-active'))),
    dotsUlY:Math.round(dotsUl.getBoundingClientRect().y+scrollY),
    sliderY:Math.round(s.getBoundingClientRect().y+scrollY),
    sliderH:Math.round(s.getBoundingClientRect().height)
  };
}),null,1));
await b.close();
