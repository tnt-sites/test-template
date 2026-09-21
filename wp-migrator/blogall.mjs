import { chromium } from 'playwright';
import fs from 'fs';
const dir='/Users/tharvey/Work/CloudCannon/northcounty/src/content/blog';
const all=fs.readdirSync(dir).filter(f=>f.endsWith('.mdx')).map(f=>{
  const t=fs.readFileSync(`${dir}/${f}`,'utf8');
  const body=t.split(/^---$/m).slice(2).join('---');
  return {slug:f.replace(/\.mdx$/,''),heads:(body.match(/^#{2,3} /gm)||[]).length,len:body.length};});
const b=await chromium.launch();
const bad=[]; let done=0;
const ctx=await b.newContext({viewport:{width:1280,height:800}});
for(const it of all){
  const p=await ctx.newPage();
  try{
    await p.goto(`https://www.ultimatesmiles.com/${it.slug}/`,{waitUntil:'domcontentloaded',timeout:40000});
    await p.waitForTimeout(1200);
    const r=await p.evaluate(()=>{
      const el=document.querySelector('.entry-content,.post-content,article')||document.body;
      return {h:el.querySelectorAll('h2,h3').length,c:el.innerText.replace(/\s+/g,' ').length};});
    if(r.h>it.heads+1) bad.push({...it,srcHeads:r.h,srcChars:r.c});
  }catch(e){ bad.push({...it,srcHeads:'ERR',srcChars:String(e.message).slice(0,30)}); }
  await p.close();
  if(++done%25===0) console.error(`  ...${done}/${all.length}`);
}
await b.close();
console.log('posts missing content:',bad.length);
for(const x of bad) console.log(` ${x.slug}  ours=${x.heads}h/${x.len}c  src=${x.srcHeads}h/${x.srcChars}c`);
