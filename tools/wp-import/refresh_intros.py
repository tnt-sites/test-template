"""Refresh each banner's intro from the snapshot, and drop the paragraphs that
previously spilled into the page body because of the old 2-paragraph cap."""
import re,html,glob,os,sys,yaml
ROOT="/Users/tharvey/Work/CloudCannon/northcounty"
SNAP=f"{ROOT}/wp-migrator/.wpmig/static"
PAGES=f"{ROOT}/src/content/pages/vista-ca"
WRITE='--write' in sys.argv
CALL=re.compile(r'\(?760\)?[\s.-]?206[\s.-]?6\d{3}')

def t(s):
    s=re.sub(r'<(/?)(span|br|b|strong|em|i)\b[^>]*>',' ',s)
    out=html.unescape(re.sub(r'\s+',' ',re.sub(r'<[^>]+>','',s))).strip()
    return CALL.sub('(760) 940-2273',out)

def norm(s): return re.sub(r'\s+',' ',(s or '')).strip().lower()

def banner_paras(snapfile):
    h=re.sub(r'<(style|script)\b.*?</\1>','',open(snapfile,encoding='utf8',errors='replace').read(),flags=re.S|re.I)
    m=re.search(r'<(?:div|section) class="[^"]*\binner-intro\b[^"]*"',h)
    if not m: return []
    seg=h[m.start():m.start()+9000]
    h1=re.search(r'<h1[^>]*>(.*?)</h1>',seg,re.S)
    if not h1: return []
    after=seg[h1.end():]
    col=re.search(r'(.*?)<!--\s*Contact Form',after,re.S)
    body=col.group(1) if col else after[:4000]
    return [x for x in (t(p) for p in re.findall(r'<p[^>]*>(.*?)</p>',body,re.S)) if len(x)>12]

n=0
for md in sorted(glob.glob(f"{PAGES}/*.md")+glob.glob(f"{PAGES}/../*.md")):
    slug=os.path.basename(md)[:-3]
    snap=f"{SNAP}/vista-ca-{slug}.html" if "/vista-ca/" in os.path.normpath(md) else f"{SNAP}/{slug}.html"
    if not os.path.isfile(snap): snap=f"{SNAP}/{slug}.html"
    if not os.path.isfile(snap): continue
    paras=banner_paras(snap)
    if not paras: continue
    raw=open(md,encoding='utf8').read(); parts=raw.split('---\n')
    d=yaml.safe_load(parts[1]); secs=d.get('pageSections') or []
    banner=next((s for s in secs if s.get('_component','').endswith('page-banner')),None)
    if not banner: continue
    # keep them as separate paragraphs, not one joined string
    cur=banner.get('intro')
    cur_list=cur if isinstance(cur,list) else ([cur] if cur else [])
    if [norm(x) for x in cur_list]==[norm(x) for x in paras]: continue
    banner['intro']=paras
    # drop any body section that only repeats banner paragraphs
    wrap=next((s for s in secs if s.get('_component','').endswith('content-with-sidebar')),None)
    main=(wrap.get('main') if wrap else secs) or []
    keep=[]
    known={norm(p) for p in paras}
    for sec in main:
        if sec.get('_component')!='page-sections/builders/custom-section': keep.append(sec); continue
        cs=sec.get('contentSections') or []
        rest=[c for c in cs if not ('core-elements/text' in (c.get('_component') or '')
                                    and norm(c.get('text')) in known)]
        if not rest and len(cs)>0: continue          # section was only banner text
        if len(rest)!=len(cs): sec['contentSections']=rest
        keep.append(sec)
    if wrap: wrap['main']=keep
    else: d['pageSections']=keep
    if WRITE:
        open(md,'w',encoding='utf8').write('---\n'+yaml.safe_dump(d,sort_keys=False,allow_unicode=True,width=100)+'---\n')
    n+=1
print(f"{'refreshed' if WRITE else 'would refresh'} {n} banners")
