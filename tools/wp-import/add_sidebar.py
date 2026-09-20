"""Move Related Topics / additional-topics into a right rail, as on the source.

On the source every interior page is a two-column layout: the content column
with a 307px .side-bar holding exactly these two blocks (101 and 100 of the 133
pages respectively). They currently render full-width at the foot of the page.
"""
import glob,os,sys,yaml
WRITE='--write' in sys.argv
# full-width pages: the homepage and the galleries are not the interior layout
SKIP_SLUGS={'index','blog','contact-us','search','sitemap','smile-gallery','video-gallery',
            'reviews','patient-testimonials','north-county-cosmetic-and-implant-dentistry-videos',
            'opt-out-preferences','yelp','google','facebook',
            # the services landing page is full-width on the source: one grey band
            # holding the heading, the search box and the eight service cards
            'services'}
PAGES="/Users/tharvey/Work/CloudCannon/northcounty/src/content/pages/vista-ca"
SIDEBAR_LABELS=("related topics","explore additional topics")

def is_sidebar(sec):
    lbl=(sec.get('label') or sec.get('heading') or '').strip().lower()
    return any(lbl.startswith(x) for x in SIDEBAR_LABELS)

def main():
    n=skipped=0
    for md in sorted(glob.glob(f"{PAGES}/*.md")+glob.glob(f"{PAGES}/../*.md")):
        slug=os.path.basename(md)[:-3]
        if '/vista-ca/' not in os.path.normpath(md) and slug in SKIP_SLUGS: continue
        raw=open(md,encoding='utf8').read(); parts=raw.split('---\n')
        if len(parts)<3: continue
        d=yaml.safe_load(parts[1])
        secs=d.get('pageSections') or []
        if any(s.get('_component')=='page-sections/builders/content-with-sidebar' for s in secs):
            continue
        side=[s for s in secs if is_sidebar(s)]
        rest=[s for s in secs if not is_sidebar(s)]
        # the hero leads and the form trails; everything between is the content column
        lead=[]; trail=[]
        while rest and rest[0].get('_component') in (
                'page-sections/heroes/hero-split',
                'page-sections/heroes/page-banner'): lead.append(rest.pop(0))
        while rest and rest[-1].get('_component') in (
                'page-sections/forms/liine-form',
                'page-sections/info-blocks/page-footer-nav'): trail.insert(0,rest.pop())
        if not rest: skipped+=1; continue
        # inside the rail the panels are compact; drop their own section chrome
        for s in side:
            s['paddingVertical']='md'
            s['maxContentWidth']='none'
            s['paddingHorizontal']='md'
        wrapper={'_component':'page-sections/builders/content-with-sidebar',
                 'main':rest,'sidebar':side,'maxContentWidth':'2xl','paddingVertical':'xl'}
        d['pageSections']=lead+[wrapper]+trail
        if WRITE:
            open(md,'w',encoding='utf8').write('---\n'+yaml.safe_dump(d,sort_keys=False,allow_unicode=True,width=100)+'---\n')
        n+=1
    print(f"{'restructured' if WRITE else 'would restructure'} {n} pages  (skipped {skipped})")

main()
