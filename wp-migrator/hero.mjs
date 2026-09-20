import { chromium } from 'playwright';
const b=await chromium.launch();
const p=await b.newPage({viewport:{width:1440,height:1000}});
await p.goto('https://www.ultimatesmiles.com/',{waitUntil:'domcontentloaded',timeout:60000});
await p.waitForTimeout(6000);
console.log(JSON.stringify(await p.evaluate(()=>{
  const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).display!=='none';};
  const box=e=>{const r=e.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y+scrollY),w:Math.round(r.width),h:Math.round(r.height)};};
  const h1=document.querySelector('h1');
  const heroImg=[...document.querySelectorAll('img')].filter(vis).find(e=>e.getBoundingClientRect().width>600);
  const form=[...document.querySelectorAll('iframe')].filter(vis).find(e=>/liine|jotform/i.test(e.src));
  const welcome=[...document.querySelectorAll('h1,h2')].find(e=>/Welcome to/i.test(e.textContent));
  // the three info cards
  const cards=[...document.querySelectorAll('div')].filter(e=>vis(e)&&/Our Experience/i.test(e.textContent)&&e.textContent.length<400);
  const card=cards[cards.length-1];
  return {
    h1:h1?{...box(h1),text:h1.textContent.trim().slice(0,40),
      size:getComputedStyle(h1).fontSize,weight:getComputedStyle(h1).fontWeight,align:getComputedStyle(h1).textAlign}:null,
    heroImg:heroImg?{...box(heroImg),src:heroImg.currentSrc.split('/').pop()}:null,
    form:form?box(form):null,
    welcome:welcome?{...box(welcome),tag:welcome.tagName}:null,
    card:card?box(card):null,
    pageH:document.body.scrollHeight
  };
}),null,1));
await b.close();
