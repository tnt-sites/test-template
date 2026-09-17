"""Generate CloudCannon pages for the theme-rendered pages, from the snapshot."""
import sys,os,re,json,yaml
SC=sys.argv[1]; WRITE='--write' in sys.argv
ROOT="/Users/tharvey/Work/CloudCannon/northcounty"
SNAP=f"{ROOT}/wp-migrator/.wpmig/static"
DEST=f"{ROOT}/src/content/pages"
exec(open(f"{SC}/snap_pages.py").read().split("if __name__")[0])

AV=set(os.listdir(f"{ROOT}/src/assets/images/wp"))
SIZED=re.compile(r'^(.*)-(\d{2,4})x(\d{2,4})(\.[a-zA-Z0-9]+)$')
def imgmap(src):
    m=re.search(r'/wp-content/uploads/(.+)$',src.split('?')[0])
    if not m: return None
    b=os.path.basename(m.group(1)); s=SIZED.match(b)
    for c in ((s.group(1)+s.group(4)) if s else b, b):
        if c in AV: return f"/src/assets/images/wp/{c}"
    return None

SIZE_FOR_LEVEL={'h1':'2xl','h2':'xl','h3':'md','h4':'sm','h5':'sm','h6':'xs'}
LINK_FIX={
 'about.html':'/about/','first-visit.html':'/first-visit/','contact-us.html':'/contact-us/',
 'services.html':'/services/','index.html':'/','blog.html':'/blog/',
 '/vista-ca/implants/':'/vista-ca/implants-vs-mini-implants/',
}
def fix_link(u):
    u=(u or '').replace('https://www.ultimatesmiles.com','').replace('http://www.ultimatesmiles.com','')
    return LINK_FIX.get(u,u)

BG={'bg-primary':'accent','bg-secondary':'surface','bg-body-complement':'base',
    'bg-body':'base','bg-mute':'surface','bg-tertiary':'highlight'}
def bg_of(cls):
    for w in cls.split():
        if w in BG: return BG[w]
    return 'base'

def cards_section(b,heading=''):
    return {'_component':'page-sections/ctas/services-grid','heading':heading,
      'services':[{'_component':'page-sections/ctas/services-grid/services-grid-item',
                   'imageSource':c['image'],'imageAlt':c['title'],'title':c['title'],
                   'href':fix_link(c['url']),'wide':False,'links':[]} for c in b['items']]}

def blocks_to_content(blocks):
    out=[]
    for b in blocks:
        if b['type']=='cards': continue
        if b['type']=='heading':
            lvl=b.get('level','h2')
            out.append({'_component':'building-blocks/core-elements/heading',
                        'text':b['text'],'level':lvl,'size':SIZE_FOR_LEVEL.get(lvl,'md')})
        elif b['type']=='paragraph':
            out.append({'_component':'building-blocks/core-elements/text','text':b['text']})
        elif b['type']=='list':
            out.append({'_component':'building-blocks/core-elements/list',
                        'listType':'numbered' if b.get('ordered') else 'bullet',
                        'items':[{'_component':'building-blocks/core-elements/list/list-item','text':i}
                                 for i in b['items']]})
        elif b['type']=='embed':
            src=b.get('src','')
            if src.startswith('//'): src='https:'+src
            if src:
                title=(b.get('title') or 'Video').replace('"','&quot;')
                out.append({'_component':'building-blocks/core-elements/embed',
                            'html':('<iframe src="%s" title="%s" frameborder="0" loading="lazy" '
                                    'allow="accelerometer; autoplay; clipboard-write; encrypted-media; '
                                    'gyroscope; picture-in-picture" allowfullscreen></iframe>'
                                    % (src,title)),
                            'aspectRatio':'widescreen'})
        elif b['type']=='image':
            out.append({'_component':'building-blocks/core-elements/image',
                        'source':b['src'],'alt':b.get('alt','')})
    return out

# page slug -> (snapshot file, output path)
TARGETS={
 'about':('about.html','about'),
 'first-visit':('first-visit.html','first-visit'),
 'reviews':('reviews.html','reviews'),
 'smile-gallery':('smile-gallery.html','smile-gallery'),
 'contact-us':('contact-us.html','contact-us'),
 # 'home' is deliberately absent. The homepage is hand-built against the
 # source - a three-slide hero-slider with the form docked over it, then
 # intro-cards, services-grid and location-map. Regenerating it from the
 # snapshot flattens that into a generic hero-split plus a form band,
 # which is how index.md was clobbered in 8521002e.
 'video-gallery':('video-gallery.html','video-gallery'),
 'services':('services.html','services'),
}
LIINE={'contact-us':'251055835049963'}
# pages that show a form in the page flow rather than only in a modal
FORM_PAGES=set()

def main():
    yo=json.load(open(f"{SC}/yoast.json"))
    pages={p['slug']:p for p in json.load(open(f"{SC}/db-pages.json"))}
    n=0
    for slug,(fn,out) in TARGETS.items():
        path=os.path.join(SNAP,fn)
        if not os.path.isfile(path): print("  no snapshot:",fn); continue
        raw=open(path,encoding='utf8',errors='replace').read()
        prs=pairs_from(raw,imgmap)
        icards=infocards_from(raw,imgmap)
        secs=extract(path,imgmap)
        if icards:
            # the card grid owns these titles/images; drop the flattened copies
            ct={c['title'] for c in icards}; ci={c['image'] for c in icards if c['image']}
            for sec in secs:
                sec['blocks']=[b for b in sec['blocks']
                    if not (b['type']=='heading' and b['text'] in ct)
                    and not (b['type']=='image' and b.get('src') in ci)
                    and not (b['type']=='paragraph' and any(b['text'][:60] in c['description'] for c in icards))]
        if prs:
            # the gallery images are consumed by the pair grid; drop the loose copies
            used={x['beforeSource'] for x in prs}|{x['afterSource'] for x in prs}
            for sec in secs:
                sec['blocks']=[b for b in sec['blocks']
                               if not (b['type']=='image' and b.get('src') in used)]
        sections=[]
        for s in secs:
            head=[b['text'] for b in s['blocks'] if b['type']=='heading']
            content=blocks_to_content(s['blocks'])
            if content:
                sections.append({'_component':'page-sections/builders/custom-section',
                    'label':head[0][:60] if head else '','contentSections':content,
                    'maxContentWidth':'xl','paddingHorizontal':'lg','paddingVertical':'xl',
                    'colorScheme':'default','backgroundColor':bg_of(s['cls'])})
            for b in s['blocks']:
                if b['type']=='cards':
                    sections.append(cards_section(b,head[0] if head else ''))
        if icards:
            sections.append({'_component':'page-sections/features/info-card-grid','heading':'',
                'cards':[{'_component':'page-sections/features/info-card-grid/card',
                          **{**c,'linkUrl':fix_link(c.get('linkUrl',''))}} for c in icards],
                'minItemWidth':280,'backgroundColor':'base'})
        if prs:
            sections.append({'_component':'page-sections/features/before-after-gallery',
                'heading':'Smile Gallery','beforeLabel':'Before','afterLabel':'After',
                'pairs':[{'_component':'page-sections/features/before-after-gallery/pair',**x} for x in prs],
                'backgroundColor':'base'})
        # Only some pages show a form in the page flow. Checked in a browser:
        # pages with a banner carry it inside the banner (330x420), contact-us
        # has a full-width one, and the galleries have none at all - their Liine
        # iframes live in the fixed-tab modals, which are not page content.
        if slug in FORM_PAGES:
            fid=LIINE.get(slug,'251056297507965')
            sections.append({'_component':'page-sections/forms/liine-form','formId':fid,
                'heading':'Request an Appointment','subtext':'',
                'title':'North County Cosmetic and Implant Dentistry - Request an Appointment Form',
                'height':539,'backgroundColor':'surface'})
        if slug=='reviews':
            # The testimonials live in a Slick carousel whose cloned slides make
            # every card look identical to the section de-duplicator, so build
            # the list directly from the markup instead.
            raw_html=open(path,encoding='utf8',errors='replace').read()
            raw_html=re.sub(r'<(style|script)\b.*?</\1>','',raw_html,flags=re.S|re.I)
            seen=set(); cards=[]
            for mm in re.finditer(r'<div class="testimonial-body">(.*?)(?=<div class="testimonial-heading"|<div class="testimonials-wrap|$)',raw_html,re.S):
                blk=mm.group(1)
                vid=re.search(r'youtube\.com/embed/([A-Za-z0-9_-]+)',blk)
                if not vid or vid.group(1) in seen: continue
                seen.add(vid.group(1))
                ttl=re.search(r'<div class="title">(.*?)</div>',blk,re.S)
                cards.append({'title':t(ttl.group(1)) if ttl else '','id':vid.group(1)})
            if cards:
                # The source runs these as a Slick slider; ReviewsCarousel is
                # the CloudCannon carousel redesigned for the title+video pair,
                # so each testimonial stays intact as one typed slide.
                sections=[s for s in sections
                          if not any('core-elements/embed' in (x.get('_component') or '')
                                     for x in (s.get('contentSections') or []))]
                sections.append({'_component':'page-sections/media/reviews-carousel',
                    'label':'Patient Testimonials',
                    'reviews':[{'title':c['title'],'videoId':c['id']} for c in cards],
                    'slideWidth':383,'showIndicators':True,'showArrows':False,
                    'autoPlay':False})
        if slug=='contact-us':
            intro=[c for sec in sections for c in (sec.get('contentSections') or [])
                   if 'core-elements/text' in (c.get('_component') or '')][:2]
            head=next((c for sec in sections for c in (sec.get('contentSections') or [])
                       if 'core-elements/heading' in (c.get('_component') or '')),None)
            sections=[{'_component':'page-sections/builders/custom-section',
                'label':'Location & Contact Information',
                'contentSections':([head] if head else [])+intro,
                'maxContentWidth':'2xl','paddingHorizontal':'lg','paddingVertical':'xl',
                'colorScheme':'default','backgroundColor':'surface'},
              {'_component':'page-sections/info-blocks/contact-panel',
               'formHeading':'Contact Us','formId':'251055835049963',
               'formTitle':'North County Cosmetic and Implant Dentistry - Contact Form',
               'formHeight':620,
               'imageSource':'/src/assets/images/wp/18-1.jpg',
               'imageAlt':'The North County Cosmetic and Implant Dentistry team',
               'panelHeading':'Contact Information',
               'address':['1934 Via Centre Ste A','Vista, CA 92081'],
               'mapUrl':'https://maps.app.goo.gl/mwYFRCsLFsKPbFYQA',
               'phone':'(760) 940-2273','phoneHref':'tel:+1-760-940-2273',
               'hours':[{'day':'Monday','time':'7:30AM to 5:00PM'},
                        {'day':'Tuesday','time':'7:00AM to 5:00PM'},
                        {'day':'Wednesday','time':'7:30AM to 5:00PM'},
                        {'day':'Thursday','time':'7:00AM to 5:00PM'},
                        {'day':'Friday','time':'Closed'},
                        {'day':'Saturday','time':'Closed'},
                        {'day':'Sunday','time':'Closed'}],
               'hoursNote':'Fridays by Appointment Only'}]

        p=pages.get(slug,{})
        y=yo.get(str(p.get('id')),{}) if p else {}
        fm={'_schema':'default','title':p.get('title') or slug.replace('-',' ').title(),
            'seo':{'title':y.get('title',''),'description':y.get('description','')},
            'pageSections':sections}
        if WRITE:
            fp=os.path.join(DEST,out+'.md')
            os.makedirs(os.path.dirname(fp),exist_ok=True)
            open(fp,'w').write('---\n'+yaml.safe_dump(fm,sort_keys=False,allow_unicode=True,width=100)+'---\n')
        n+=1
        print(f"  {slug:18s} -> {out}.md  sections={len(sections)}")
    print(f"{'wrote' if WRITE else 'would write'} {n} pages")
main()
