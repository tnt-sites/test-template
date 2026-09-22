import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const msgs=[];
p.on('console', m => msgs.push(m.text()));
p.on('pageerror', e => msgs.push('PAGEERROR '+e.message));
await p.goto("http://localhost:4340/cavities-fillings/", { waitUntil: "domcontentloaded", timeout: 60000 });
await p.evaluate(async () => { for(let y=0;y<document.body.scrollHeight;y+=400){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,50));} });
await p.waitForTimeout(12000);
const rw = await p.evaluate(() => {
  const el=document.querySelector('.reviews-widget');
  return el ? {html: el.innerHTML.slice(0,300), height: el.getBoundingClientRect().height} : null;
});
console.log("reviews-widget:", JSON.stringify(rw));
console.log("trustindex-related console:", msgs.filter(m=>/trust|widget|review|cors|blocked|refused/i.test(m)).slice(0,8));
const el = await p.$('.reviews-widget');
if (el) await el.screenshot({ path: "/Users/tharvey/Work/CloudCannon/toothbar/wp-migrator/.wpmig/shots/reviews-only.png" }).catch(()=>{});
await b.close();
