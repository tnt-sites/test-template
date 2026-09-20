import { chromium } from 'playwright';
const SC='/private/tmp/claude-501/-Users-tharvey-Work-CloudCannon-northcounty/fdb7a81a-57ec-4eee-aadb-b03a080cf26e/scratchpad';
const b=await chromium.launch();
for(const [k,u] of [['built','http://localhost:4321/'],['src','https://www.ultimatesmiles.com/']]){
  const p=await b.newPage({viewport:{width:1440,height:1000}});
  const errs=[];
  p.on('pageerror',e=>errs.push(e.message.slice(0,120)));
  await p.goto(u,{waitUntil:'domcontentloaded',timeout:60000});
  await p.evaluate(async()=>{for(let y=0;y<document.body.scrollHeight;y+=400){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,120));}window.scrollTo(0,0);});
  await p.waitForTimeout(3500);
  const info=await p.evaluate(()=>{
    const cs=getComputedStyle(document.body);
    return {h:document.body.scrollHeight,bg:cs.backgroundColor,color:cs.color,
      sections:[...document.querySelectorAll('main > *, main section')].slice(0,14).map(e=>{
        const r=e.getBoundingClientRect(); const s=getComputedStyle(e);
        return `${e.tagName.toLowerCase()}.${(e.className||'').toString().split(' ').slice(0,2).join('.')} h=${Math.round(r.height)} bg=${s.backgroundColor}`;
      })};
  });
  console.log('===',k,JSON.stringify(info,null,1));
  if(errs.length) console.log('  pageerrors:',errs);
  await p.screenshot({path:`${SC}/home-${k}.png`,fullPage:true});
  await p.close();
}
await b.close();
