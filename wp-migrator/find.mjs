import { chromium } from "playwright";
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:1000}});
await p.goto(process.argv[2],{waitUntil:"networkidle"}); await p.waitForTimeout(1200);
console.log(JSON.stringify(await p.evaluate(()=>{
  const dl=document.querySelector(".definition-list");
  if(!dl) return "no definition-list";
  let n=dl, path=[];
  while(n && n!==document.body){
    const cs=getComputedStyle(n);
    path.push({tag:n.tagName.toLowerCase(),
      cls:(typeof n.className==="string"?n.className:"").trim().split(/\s+/).slice(0,3).join("."),
      mT:cs.marginTop, mB:cs.marginBottom, bg:cs.backgroundColor, pad:cs.paddingTop});
    n=n.parentElement;
  }
  return path;
}),null,1));
await b.close();
