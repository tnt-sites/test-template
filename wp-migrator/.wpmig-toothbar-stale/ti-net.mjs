import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage();
const urls=[];
p.on('request', r => { const u=r.url(); if(/trustindex/i.test(u)) urls.push(u); });
const responses=[];
p.on('response', async r => {
  const u=r.url();
  if(/trustindex/i.test(u) && /widget|content|data|json|53ff23835/i.test(u)) {
    try { const t=await r.text(); responses.push([u, t.length, t.slice(0,200)]); } catch{}
  }
});
await p.goto("http://localhost:4339/cavities-fillings/", { waitUntil: "domcontentloaded", timeout: 60000 });
await p.waitForTimeout(10000);
console.log("=== trustindex requests ===");
[...new Set(urls)].forEach(u=>console.log(u));
console.log("=== responses (widget/data) ===");
responses.forEach(([u,len,prev])=>console.log(`${u}\n  len=${len} preview=${prev.replace(/\n/g,' ')}\n`));
await b.close();
