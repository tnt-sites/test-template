"""Give each interior page the source's banner: service image + H1/intro + form.

The DB page content has no banner — it is assembled by the theme — so the image
and intro come from the rendered snapshot, keyed by the page's flat slug.
"""
import re,os,sys,glob,html,yaml
ROOT="/Users/tharvey/Work/CloudCannon/northcounty"
SNAP=f"{ROOT}/wp-migrator/.wpmig/static"
PAGES=f"{ROOT}/src/content/pages"
WRITE='--write' in sys.argv
# full-width pages: the homepage and the galleries are not the interior layout
SKIP_SLUGS={'index','blog','contact-us','search','sitemap','smile-gallery','video-gallery',
            'patient-testimonials','north-county-cosmetic-and-implant-dentistry-videos',
            'opt-out-preferences','yelp','google','facebook'}
AV=set(os.listdir(f"{ROOT}/src/assets/images/wp"))
SIZED=re.compile(r'^(.*)-(\d{2,4})x(\d{2,4})(\.[a-zA-Z0-9]+)$')
CALL=re.compile(r'\(?760\)?[\s.-]?206[\s.-]?6\d{3}')

def t(s):
    s=re.sub(r'<(/?)(span|br|b|strong|em|i)\b[^>]*>',' ',s)
    out=html.unescape(re.sub(r'\s+',' ',re.sub(r'<[^>]+>','',s))).strip()
    return CALL.sub('(760) 940-2273',out)

def local(src):
    b=os.path.basename((src or '').split('?')[0])
    z=SIZED.match(b)
    for c in ((z.group(1)+z.group(4)) if z else b, b):
        if c in AV: return f"/src/assets/images/wp/{c}"
    return None

def banner_of(snapfile):
    h=open(snapfile,encoding='utf8',errors='replace').read()
    # strip <style>/<script> first: the theme's CSS mentions .inner-intro long
    # before the markup does, and a plain .find() lands inside the stylesheet.
    h=re.sub(r'<(style|script)\b.*?</\1>','',h,flags=re.S|re.I)
    m=re.search(r'<(?:div|section) class="[^"]*\binner-intro\b[^"]*"',h)
    if not m: return None
    i=m.start()
    seg=h[i:i+6000]
    img=re.search(r'inner-image-container.*?<img[^>]*src="([^"?]+)"[^>]*?(?:alt="([^"]*)")?',seg,re.S)
    h1=re.search(r'<h1[^>]*>(.*?)</h1>',seg,re.S)
    if not h1: return None
    raw_h1=h1.group(1)
    loc=re.search(r'<span[^>]*>(.*?)</span>',raw_h1,re.S)
    location=t(loc.group(1)) if loc else ''
    name=t(re.sub(r'<span[^>]*>.*?</span>','',raw_h1,flags=re.S))
    # intro paragraphs sit in the .content-block next to the h1
    after=seg[h1.end():h1.end()+3000]
    ps=[t(x) for x in re.findall(r'<p[^>]*>(.*?)</p>',after,re.S)]
    # Keep every paragraph in the banner column. The old [:2] cap pushed the
    # remainder into the page body - 33 pages carry more than two, and
    # dental-anesthesia has six.
    ps=[x for x in ps if len(x)>12]
    # Only a financing CTA belongs in the banner column. Matching any linked
    # image here pulled the ADA accreditation logo onto /about/ and pointed it
    # at ada.org, so require the link or the image to name the CTA.
    cta_img=None; cta_href=''
    for m in re.finditer(r'<a[^>]*href="([^"]*)"[^>]*>\s*<img[^>]*src="([^"?]+)"[^>]*>',seg,re.S):
        href,src=m.group(1),m.group(2)
        if re.search(r'carecredit|apply|financ',href+src,re.I):
            cta_img=local(src); cta_href=href; break
    return {'heading':name or t(raw_h1),'location':location,
            'ctaImage':cta_img or '','ctaLink':cta_href,
            'intro':ps,
            'image':local(img.group(1)) if img else None,
            'imageAlt':(img.group(2) if img and img.group(2) else (name or t(raw_h1)))}

def main():
    n=skipped=0
    for md in sorted(glob.glob(f"{PAGES}/vista-ca/*.md")+glob.glob(f"{PAGES}/*.md")):
        slug=os.path.basename(md)[:-3]
        if '/vista-ca/' not in os.path.normpath(md) and slug in SKIP_SLUGS: continue
        snap=f"{SNAP}/vista-ca-{slug}.html" if "/vista-ca/" in os.path.normpath(md) else f"{SNAP}/{slug}.html"
        if not os.path.isfile(snap): snap=f"{SNAP}/{slug}.html"
        if not os.path.isfile(snap): skipped+=1; continue
        b=banner_of(snap)
        if not b or not b['image']: skipped+=1; continue
        raw=open(md,encoding='utf8').read()
        parts=raw.split('---\n')
        d=yaml.safe_load(parts[1])
        secs=d.get('pageSections') or []
        if secs and secs[0].get('_component')=='page-sections/heroes/page-banner':
            continue  # already converted
        if secs and secs[0].get('_component')=='page-sections/heroes/hero-split':
            secs=secs[1:]  # replace the earlier hero with the real banner
        # the generated page opens with a custom-section repeating the H1; drop it
        if secs and secs[0].get('_component')=='page-sections/builders/custom-section':
            cs=secs[0].get('contentSections') or []
            if cs and cs[0].get('_component')=='building-blocks/core-elements/heading' \
               and cs[0].get('level')=='h1':
                rest=[x for x in cs[1:] if x.get('_component')!='building-blocks/core-elements/heading']
                if len(rest)<=2: secs=secs[1:]
        hero={'_component':'page-sections/heroes/page-banner',
              'heading':b['heading'],'location':b.get('location',''),'intro':b['intro'],
              'imageSource':b['image'],'imageAlt':b['imageAlt'],
              'formId':'251056297507965','formHeading':'Request An Appointment',
              'formTitle':'North County Cosmetic and Implant Dentistry - Request an Appointment Form',
              'formHeight':420,'buttonText':'','buttonLink':'',
              'ctaImage':b.get('ctaImage',''),'ctaImageAlt':'Apply for CareCredit financing',
              'ctaLink':b.get('ctaLink','')}
        # the banner carries the form, so the page does not need a second one
        secs=[x for x in secs if x.get('_component')!='page-sections/forms/liine-form']
        d['pageSections']=[hero]+secs
        if WRITE:
            open(md,'w',encoding='utf8').write('---\n'+yaml.safe_dump(d,sort_keys=False,allow_unicode=True,width=100)+'---\n')
        n+=1
    print(f"{'updated' if WRITE else 'would update'} {n} interior pages  (skipped {skipped})")

main()
