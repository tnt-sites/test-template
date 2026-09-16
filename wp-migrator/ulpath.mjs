import { chromium } from "playwright";
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:900}});
await p.goto(process.argv[2],{waitUntil:"networkidle"}); await p.waitForTimeout(1000);
console.log(JSON.stringify(await p.evaluate(()=>{
  const li=document.querySelector(".cws-main ul li");
  if(!li) return "no li";
  const path=[]; let n=li;
  while(n && n!==document.body){ path.push(n.tagName.toLowerCase()+(n.className&&typeof n.className==="string"&&n.className.trim()?"."+n.className.trim().split(/\s+/).slice(0,3).join("."):"")); n=n.parentElement; }
  const cs=getComputedStyle(li);
  return {path:path.reverse().join(" > "), display:cs.display, listStyle:cs.listStyleType,
    before:getComputedStyle(li,"::before").content, inMain:!!li.closest("main")};
}),null,1));
await b.close();
