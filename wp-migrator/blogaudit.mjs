import { chromium } from 'playwright';
import fs from 'fs';
const dir='/Users/tharvey/Work/CloudCannon/northcounty/src/content/blog';
const all=fs.readdirSync(dir).filter(f=>f.endsWith('.mdx'));
// sample 14 across the size range
const withLen=all.map(f=>{const t=fs.readFileSync(`${dir}/${f}`,'utf8');
  const body=t.split(/^---$/m).slice(2).join('---');
  return {f,slug:f.replace(/\.mdx$/,''),len:body.length,
    heads:(body.match(/^#{2,3} /gm)||[]).length};});
withLen.sort((a,b)=>a.len-b.len);
const pick=[...withLen.slice(0,5), ...withLen.filter((_,i)=>i%Math.floor(withLen.length/9)===0)].slice(0,14);
const b=await chromium.launch();
console.log('slug | ourHeads | srcHeads | ourChars | srcChars');
for(const it of pick){
  const p=await b.newPage({viewport:{width:1440,height:1000}});
  let r={h:0,c:0,status:0};
  try{
    const resp=await p.goto(`https://www.ultimatesmiles.com/${it.slug}/`,{waitUntil:'domcontentloaded',timeout:45000});
    r.status=resp?resp.status():0;
    await p.waitForTimeout(2500);
    r=await p.evaluate(()=>{
      const el=document.querySelector('.entry-content,.post-content,article')||document.body;
      return {h:el.querySelectorAll('h2,h3').length,c:el.innerText.replace(/\s+/g,' ').length,status:200};
    });
  }catch(e){ r.status=-1; }
  const flag=(r.h>it.heads+1)?'  <-- MISSING':'';
  console.log(`${it.slug.slice(0,44).padEnd(46)} ${String(it.heads).padStart(2)} | ${String(r.h).padStart(2)} | ${String(it.len).padStart(5)} | ${String(r.c).padStart(5)}${flag}`);
  await p.close();
}
await b.close();
