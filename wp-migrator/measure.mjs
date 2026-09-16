import { chromium } from "playwright";
import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.argv[2];
const PAGE = process.argv[3] || "index.html";
const MIME = { ".html":"text/html", ".css":"text/css", ".js":"text/javascript", ".jpg":"image/jpeg",
  ".jpeg":"image/jpeg", ".png":"image/png", ".gif":"image/gif", ".svg":"image/svg+xml",
  ".woff":"font/woff", ".woff2":"font/woff2", ".ttf":"font/ttf", ".webp":"image/webp", ".ico":"image/x-icon" };

const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/" + PAGE;
  const f = path.join(ROOT, p);
  if (fs.existsSync(f) && fs.statSync(f).isFile()) {
    res.writeHead(200, { "content-type": MIME[path.extname(f).toLowerCase()] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  } else { res.writeHead(404); res.end("nf"); }
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`http://localhost:${port}/${PAGE}`, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(1500);

const out = await page.evaluate(() => {
  const pick = (el, props) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const o = { _box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
    for (const p of props) o[p] = cs.getPropertyValue(p);
    return o;
  };
  const BOX = ["background-color","color","font-family","font-size","font-weight","letter-spacing",
    "text-transform","padding-top","padding-bottom","padding-left","padding-right","border-radius",
    "border-bottom","box-shadow","line-height","text-align"];
  const q = (s) => document.querySelector(s);
  return {
    topbar: pick(q(".top-nav"), BOX),
    topbarLi: pick(q(".top-nav li"), BOX),
    topbarLink: pick(q(".top-nav a"), BOX),
    headerBand: pick(q("header") || q(".nav-wrapper") || q(".main-nav-wrapper"), BOX),
    logo: pick(q(".brand-logo img") || q("header img") || q(".logo img"), BOX),
    mainNav: pick(q(".main-nav"), BOX),
    navLink: pick(q(".main-nav > li > a"), BOX),
    dropdown: pick(q(".dropdown-content"), BOX),
    dropdownLink: pick(q(".dropdown-content a"), BOX),
    footer: pick(q("footer") || q(".footer"), BOX),
    footerHeading: pick(q("footer h1, footer h2, footer h3, footer h4, footer h5"), BOX),
    footerLink: pick(q("footer a"), BOX),
    h1: pick(q("h1"), BOX),
    h2: pick(q("h2"), BOX),
    h3: pick(q("h3"), BOX),
    body: pick(document.body, BOX),
    para: pick(q("p"), BOX),
    btn: pick(q(".btn, .button, a.btn-large, .waves-effect"), BOX),
  };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
server.close();
