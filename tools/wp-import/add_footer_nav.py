"""Append the source's back-to-top line and breadcrumb trail to interior pages."""
import re,html,glob,os,sys,yaml
ROOT="/Users/tharvey/Work/CloudCannon/northcounty"
SNAP=f"{ROOT}/wp-migrator/.wpmig/static"
PAGES=f"{ROOT}/src/content/pages/vista-ca"
WRITE='--write' in sys.argv
# full-width pages: the homepage and the galleries are not the interior layout
SKIP_SLUGS={'index','blog','contact-us','search','sitemap','smile-gallery','video-gallery',
            'reviews','patient-testimonials','north-county-cosmetic-and-implant-dentistry-videos',
            'opt-out-preferences','yelp','google','facebook'}

def t(s): return html.unescape(re.sub(r'\s+',' ',re.sub(r'<[^>]+>','',s))).strip()

def route(href):
    """vista-ca-foo.html?lnsg=... -> /vista-ca/foo/"""
    h=(href or '').split('?')[0].split('#')[0]
    if not h.endswith('.html'): return h
    stem=os.path.basename(h)[:-5]
    if stem=='vista-ca': return '/vista-ca/'
    if stem.startswith('vista-ca-'): return f"/vista-ca/{stem[len('vista-ca-'):]}/"
    return f"/{stem}/"

def extract(snapfile):
    h=re.sub(r'<(style|script)\b.*?</\1>','',open(snapfile,encoding='utf8',errors='replace').read(),flags=re.S|re.I)
    out={'backToTopText':'','backToTopHref':'#top','crumbs':[]}
    m=re.search(r'Back to top of\s*<a[^>]*href="([^"]*)"[^>]*>(.*?)</a>',h,re.S)
    if m:
        out['backToTopText']=t(m.group(2))
        frag=m.group(1).split('#')
        out['backToTopHref']='#'+frag[1] if len(frag)>1 else '#top'
    bc=re.search(r'<section class="breadcrumbs.*?</section>',h,re.S)
    if bc:
        for a,b in re.findall(r'<a[^>]*href="([^"]*)"[^>]*>(.*?)</a>',bc.group(0),re.S):
            name=t(b)
            if name: out['crumbs'].append({'name':name,'url':route(a)})
    return out if (out['backToTopText'] or out['crumbs']) else None

def main():
    n=skipped=0
    for md in sorted(glob.glob(f"{PAGES}/*.md")+glob.glob(f"{PAGES}/../*.md")):
        slug=os.path.basename(md)[:-3]
        if '/vista-ca/' not in os.path.normpath(md) and slug in SKIP_SLUGS: continue
        snap=f"{SNAP}/vista-ca-{slug}.html" if "/vista-ca/" in os.path.normpath(md) else f"{SNAP}/{slug}.html"
        if not os.path.isfile(snap): snap=f"{SNAP}/{slug}.html"
        if not os.path.isfile(snap): skipped+=1; continue
        data=extract(snap)
        if not data: skipped+=1; continue
        raw=open(md,encoding='utf8').read(); parts=raw.split('---\n')
        d=yaml.safe_load(parts[1]); secs=d.get('pageSections') or []
        def has_nav(lst):
            for x in lst:
                if x.get('_component')=='page-sections/info-blocks/page-footer-nav': return True
                if x.get('_component')=='page-sections/builders/content-with-sidebar':
                    if has_nav(x.get('main') or []): return True
            return False
        if has_nav(secs): continue
        nav={'_component':'page-sections/info-blocks/page-footer-nav',**data}
        # it belongs under the content column, not spanning content + sidebar
        placed=False
        for sec in secs:
            if sec.get('_component')=='page-sections/builders/content-with-sidebar':
                sec.setdefault('main',[]).append(nav); placed=True; break
        if not placed: secs.append(nav)
        d['pageSections']=secs
        if WRITE:
            open(md,'w',encoding='utf8').write('---\n'+yaml.safe_dump(d,sort_keys=False,allow_unicode=True,width=100)+'---\n')
        n+=1
    print(f"{'added' if WRITE else 'would add'} footer nav to {n} pages (skipped {skipped})")

main()
