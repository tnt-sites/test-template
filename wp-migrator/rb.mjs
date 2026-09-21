import { chromium } from 'playwright';
const b=await chromium.launch();
const p=await b.newPage({viewport:{width:1440,height:1000}});
await p.goto('https://www.ultimatesmiles.com/mini-vs-regular-dental-implants-cip107/',{waitUntil:'domcontentloaded',timeout:60000});
await p.evaluate(async()=>{for(let y=0;y<document.body.scrollHeight;y+=400){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,120));}window.scrollTo(0,0);});
await p.waitForTimeout(4000);
console.log(JSON.stringify(await p.evaluate(()=>{
  const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).display!=='none';};
  const body=document.querySelector('article,.entry-content,.post-content,main')||document.body;
  // does the literal shortcode text appear?
  const literal=/\[recent-blogs/i.test(document.body.innerText);
  // find a block of recent post links near the bottom
  const heads=[...document.querySelectorAll('h1,h2,h3,h4')].filter(vis).map(e=>e.textContent.trim().slice(0,50));
  const rel=[...document.querySelectorAll('.recent-blogs,.related-posts,[class*=recent],[class*=related]')].filter(vis)
    .slice(0,4).map(e=>({cls:(e.className||'').toString().slice(0,44),h:Math.round(e.getBoundingClientRect().height),
      links:[...e.querySelectorAll('a')].slice(0,4).map(a=>a.textContent.trim().slice(0,40))}));
  return {literalShortcodeVisible:literal, headings:heads, relatedBlocks:rel,
    bodyChars:body.innerText.length, pageH:document.body.scrollHeight};
}),null,1));
await b.close();
