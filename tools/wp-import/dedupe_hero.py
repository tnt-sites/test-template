"""Drop the banner's heading and intro where the first content section repeats them.

On these pages the source's .inner-intro and the first .main-service-content
share an opening paragraph. Keeping both prints it twice and pushes every
section's background out of step with the source.
"""
import glob,os,sys,yaml,re
WRITE='--write' in sys.argv
PAGES="/Users/tharvey/Work/CloudCannon/northcounty/src/content/pages/vista-ca"

def norm(s): return re.sub(r'\s+',' ',(s or '')).strip().lower()

n=0
for md in sorted(glob.glob(f"{PAGES}/*.md")):
    raw=open(md,encoding='utf8').read(); parts=raw.split('---\n')
    if len(parts)<3: continue
    d=yaml.safe_load(parts[1]); secs=d.get('pageSections') or []
    banner=next((s for s in secs if s.get('_component','').endswith('page-banner')),None)
    if not banner: continue
    wrap=next((s for s in secs if s.get('_component','').endswith('content-with-sidebar')),None)
    # without a wrapper the sections sit directly on the page, and main[0] is
    # the banner itself — skip past it
    main=(wrap.get('main') or []) if wrap else [x for x in secs if x is not banner]
    if not main: continue
    first=main[0]
    if first.get('_component')!='page-sections/builders/custom-section': continue
    head=norm(banner.get('heading')); loc=norm(banner.get('location'))
    full=f"{head} {loc}".strip()
    lbl=norm(first.get('label'))
    if lbl not in (full,head): continue
    cs=first.get('contentSections') or []
    intro=norm(banner.get('intro'))
    keep=[]
    for c in cs:
        comp=c.get('_component','')
        t=norm(c.get('text'))
        if 'core-elements/heading' in comp and t in (full,head): continue   # repeats the banner H1
        if 'core-elements/text' in comp and intro and t and (t in intro or intro.startswith(t[:80])): continue
        keep.append(c)
    if len(keep)==len(cs): continue
    if keep:
        first['contentSections']=keep
        # keep the source's own background for this section; only the repeated
        # heading and opening paragraph are removed
        first.pop('label',None)
        hs=[c for c in keep if 'core-elements/heading' in (c.get('_component') or '')]
        if hs: first['label']=hs[0].get('text','')
    else:
        main.pop(0)
    if wrap: wrap['main']=main
    else: d['pageSections']=[banner]+main
    if WRITE:
        open(md,'w',encoding='utf8').write('---\n'+yaml.safe_dump(d,sort_keys=False,allow_unicode=True,width=100)+'---\n')
    n+=1
print(f"{'de-duplicated' if WRITE else 'would de-duplicate'} {n} pages")
