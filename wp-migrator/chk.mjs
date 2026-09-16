import { chromium } from "playwright";
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:1000}});
await p.goto(process.argv[2],{waitUntil:"networkidle",timeout:60000}); await p.waitForTimeout(2500);
console.log(JSON.stringify(await p.evaluate(()=>{
  const ve=document.querySelector(".video-embed"), vi=ve?.querySelector("iframe");
  const g=e=>{if(!e) return "—"; const r=e.getBoundingClientRect(); const cs=getComputedStyle(e);
    return {w:Math.round(r.width),h:Math.round(r.height),pos:cs.position,ar:cs.aspectRatio};};
  const gold=document.querySelector(".custom-section.bg-gold");
  const goldBits=gold?{
    bg:getComputedStyle(gold).backgroundColor,
    heading:(()=>{const h=gold.querySelector("h1,h2,h3,h4,h5");return h?getComputedStyle(h).color:"—";})(),
    para:(()=>{const x=gold.querySelector("p");return x?getComputedStyle(x).color:"—";})(),
    link:(()=>{const a=gold.querySelector("a");return a?getComputedStyle(a).color:"—";})(),
    text:(gold.textContent||"").trim().slice(0,40)}:"no gold section";
  return {videoWrapper:g(ve), videoIframe:g(vi), gold:goldBits};
}),null,1));
await b.close();
