import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto(process.argv[2], { waitUntil: "networkidle" });
await p.waitForTimeout(1000);
console.log(JSON.stringify(await p.evaluate(() => {
  const els = [...document.querySelectorAll("a,button")].filter(e => /Call Us|Book Online|Request An/i.test(e.textContent||""));
  return els.map(e => {
    const r = e.getBoundingClientRect();
    let path=[], n=e;
    while (n && n !== document.body) { path.push(n.tagName.toLowerCase()+(n.className&&typeof n.className==="string"?"."+n.className.trim().split(/\s+/).slice(0,2).join("."):"")); n=n.parentElement; }
    return { text: (e.textContent||"").trim().slice(0,28), box: `${Math.round(r.width)}x${Math.round(r.height)} @${Math.round(r.x)},${Math.round(r.y)}`, path: path.slice(0,4).join(" < ") };
  });
}), null, 1));
await b.close();
