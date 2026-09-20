import { chromium } from 'playwright';
const b=await chromium.launch();
const p=await b.newPage({viewport:{width:1440,height:1000}});
await p.goto('https://www.ultimatesmiles.com/reviews/',{waitUntil:'domcontentloaded',timeout:60000});
await p.waitForTimeout(6000);
console.log(JSON.stringify(await p.evaluate(()=>{
  const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).display!=='none';};
  const s=document.querySelector('.testimonials-slider');
  const real=[...s.querySelectorAll('.slick-slide')].filter(e=>!e.classList.contains('slick-cloned'));
  const slide=real[1]||real[0];
  // walk the whole subtree of one slide
  const tree=[];
  const walk=(el,d)=>{
    if(d>6) return;
    const r=el.getBoundingClientRect(); const cs=getComputedStyle(el);
    if(vis(el)) tree.push({d,tag:el.tagName.toLowerCase(),cls:(el.className||'').toString().slice(0,44),
      w:Math.round(r.width),h:Math.round(r.height),
      bg:cs.backgroundColor,pad:cs.padding,radius:cs.borderRadius,
      txt:(el.children.length===0?el.textContent.trim().slice(0,28):'')});
    [...el.children].forEach(c=>walk(c,d+1));
  };
  walk(slide,0);
  // pseudo elements on the card
  const card=slide.querySelector('.testimonial-body')||slide.firstElementChild;
  const pse={};
  for(const which of ['::before','::after']){
    for(const [nm,el] of [['slide',slide],['card',card],['cardParent',card?.parentElement]]){
      if(!el) continue;
      const c=getComputedStyle(el,which);
      if(c.content && c.content!=='none') pse[nm+which]={content:c.content.slice(0,40),w:c.width,h:c.height,
        bg:c.backgroundColor,border:c.borderWidth+' '+c.borderColor,pos:c.position,left:c.left,bottom:c.bottom,top:c.top};
    }
  }
  const stars=[...slide.querySelectorAll('i,svg,span')].filter(e=>vis(e)&&/star|fa-/i.test((e.className||'').toString()+e.tagName));
  const dots=[...document.querySelectorAll('.slick-dots')].filter(vis).map(d=>{
    const r=d.getBoundingClientRect(); const li=d.querySelector('li.slick-active button, li.slick-active');
    const acs=li?getComputedStyle(li,'::before'):null;
    return {y:Math.round(r.y+scrollY),n:d.children.length,
      activeColor:acs?acs.color:null, activeContent:acs?acs.content.slice(0,10):null};
  });
  return {tree,pseudo:pse,nStars:stars.length,
    starSample:stars.slice(0,3).map(e=>({cls:(e.className||'').toString().slice(0,40),color:getComputedStyle(e).color})),
    dotRows:dots};
}),null,1));
await b.close();
