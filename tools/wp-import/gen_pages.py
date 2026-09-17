"""Map parsed WP sections -> CloudCannon page front matter using the starter's components."""
import json,sys,os,re
try:
    import yaml
except ImportError:
    yaml=None

SC=sys.argv[1]; DEST=sys.argv[2]
WRITE='--write' in sys.argv

# WP background class -> starter backgroundColor token
# Measured off the source render: .definitions and .call-out are painted the
# brand GREEN (#79a37b); faq/related/recent sections are light grey. The class
# name (bg-secondary/bg-primary) does not predict this, so key on the section
# kind where it differs.
# Measured off the source render — these are the painted colours, and the class
# name does not follow the token name:
#   bg-body-complement / (no class)  #e6e6e6 grey card  -> surface
#   bg-mute                          #ffffff white card -> base
#   bg-primary                       #dcdcdc            -> highlight
#   bg-secondary                     #79a37b green      -> accent
#   bg-tertiary                      #ba9764 gold       -> gold
# Sections alternate per page (most commonly grey then white), so the source's
# own background has to be carried through rather than forced to one value.
BG={'bg-body-complement':'surface','bg-body-mute':'base','bg-mute':'base',
    'bg-primary':'highlight','bg-secondary':'accent','bg-tertiary':'gold',
    '':'base'}

IMG_RE=re.compile(r'^https?://(?:www\.)?ultimatesmiles\.com/wp-content/uploads/(.+)$')
AVAILABLE=set(os.listdir("/Users/tharvey/Work/CloudCannon/northcounty/src/assets/images/wp")) \
    if os.path.isdir("/Users/tharvey/Work/CloudCannon/northcounty/src/assets/images/wp") else set()
SIZED=re.compile(r'^(.*)-(\d{2,4})x(\d{2,4})(\.[a-zA-Z0-9]+)$')

def local_href(href):
    """Point an uploads link at the copy under public/, and drop query strings."""
    href=(href or '').split('?')[0]
    m=re.search(r'/wp-content/uploads/(.+)$',href)
    return '/wp-content/uploads/'+m.group(1) if m else href

def img_path(src):
    """Rewrite a WP upload URL to the local asset, preferring the full-size original."""
    if not src: return None
    m=IMG_RE.match(src) or re.match(r'^/wp-content/uploads/(.+)$',src)
    if not m: return None
    base=os.path.basename(m.group(1).split('?')[0])
    s=SIZED.match(base)
    cand=(s.group(1)+s.group(4)) if s else base
    if cand in AVAILABLE: return f"/src/assets/images/wp/{cand}"
    if base in AVAILABLE: return f"/src/assets/images/wp/{base}"
    return None

# Links that 404 on the source too, pointed at the closest page that exists.
DEAD_LINK_MAP={
 # whitening: several brand-name pages collapsed into the one whitening page
 '/vista-ca/teeth-whitening/':                '/vista-ca/tooth-whitening/',
 '/vista-ca/teeth-whitening-at-dentist/':     '/vista-ca/tooth-whitening/',
 '/vista-ca/professional-teeth-whitening/':   '/vista-ca/tooth-whitening/',
 '/vista-ca/zoom-teeth-whitening/':           '/vista-ca/tooth-whitening/',
 # clear aligners: brand pages -> the clear aligner therapy page
 '/vista-ca/invisalign/':                     '/vista-ca/clear-aligner-therapy/',
 '/vista-ca/invisalign-dentist/':             '/vista-ca/clear-aligner-therapy-dentist/',
 '/vista-ca/does-invisalign-really-work/':    '/vista-ca/does-clear-aligner-therapy-really-work/',
 '/vista-ca/is-invisalign-teen-right-for-my-child/':
                                              '/vista-ca/is-clear-aligner-therapy-teen-right-for-my-child/',
 '/vista-ca/clearcorrect-braces/':            '/vista-ca/clear-braces/',
 '/vista-ca/ez-align/':                       '/vista-ca/clear-aligner-therapy/',
 '/vista-ca/fastbraces/':                     '/vista-ca/clear-braces/',
 # cosmetic services with no page of their own
 '/vista-ca/botox/':                          '/vista-ca/dental-cosmetics/',
 '/vista-ca/juvederm/':                       '/vista-ca/dental-cosmetics/',
 '/vista-ca/lumineers/':                      '/vista-ca/dental-veneers-and-dental-laminates/',
 '/vista-ca/snap-on-smile/':                  '/vista-ca/smile-makeover/',
 '/vista-ca/improve-your-smile-for-senior-pictures/':
                                              '/vista-ca/what-can-i-do-to-improve-my-smile/',
 # implants / equipment
 '/vista-ca/teethxpress/':                    '/vista-ca/implants-vs-mini-implants/',
 '/vista-ca/waterlase-iplus/':                '/vista-ca/laser-dentistry/',
 # specialists without a page
 '/vista-ca/pediatric-dentist/':              '/vista-ca/kid-friendly-dentist/',
 '/vista-ca/pediatric-dentist-vs-general-dentist/':
                                              '/vista-ca/kid-friendly-dentist/',
 '/vista-ca/tmj-dentist/':                    '/vista-ca/night-guards/',
 '/vista-ca/dental-bonding/':                 '/vista-ca/composite-fillings/',
 # flat slug for a nested page
 '/about-find-best-dentist/':                 '/about/find-best-dentist/',
 '/about-find-a-dentist/':                    '/about/find-a-dentist/',
 # astro emits sitemap-index.xml
 '/sitemap.xml':                              '/sitemap-index.xml',
}

def rewrite_link(url):
    """Map old WP URLs onto the new site's routes."""
    if not url: return url
    u=url.replace('https://www.ultimatesmiles.com','').replace('http://www.ultimatesmiles.com','')
    u=DEAD_LINK_MAP.get(u,u)
    if u.startswith('/vista-ca/'): return u
    return u

YELP_MARK='\u2063YELP\u2063'

def text_block(t):
    t=rewrite_md_links(t)
    # The Yelp call-out opens with a Yelp glyph on the source. Text renders
    # markdown with html:true, so inline the mark as a span and let CSS draw it.
    if YELP_MARK in t:
        t=t.replace(YELP_MARK,'<span class="yelp-mark" aria-hidden="true"></span>').strip()
    return {'_component':'building-blocks/core-elements/text','text':t}
# Interior content headings are 22.5px on the source - h2 and h3 are the SAME
# size there. `xl` is the homepage's 37.5px display size and must not be used
# for body headings.
SIZE_FOR_LEVEL={'h1':'2xl','h2':'md','h3':'md','h4':'sm','h5':'sm','h6':'xs'}
def heading_block(t,level='h2'):
    return {'_component':'building-blocks/core-elements/heading','text':t,'level':level,
            'size':SIZE_FOR_LEVEL.get(level,'md')}
def list_block(items,ordered=False):
    return {'_component':'building-blocks/core-elements/list',
            'listType':'numbered' if ordered else 'bullet',
            'items':[{'_component':'building-blocks/core-elements/list/list-item','text':i} for i in items]}
def deflist_block(pairs):
    return {'_component':'building-blocks/core-elements/definition-list',
            'items':[{'_component':'building-blocks/core-elements/definition-list/definition-list-item',
                      'title':p['term'],'text':p.get('definition') or p.get('answer','')} for p in pairs]}
def image_block(src,alt=''):
    p=img_path(src)
    return {'_component':'building-blocks/core-elements/image','source':p or src,'alt':alt} if p else None

def blocks_to_content(blocks):
    """Blocks -> CloudCannon content, collapsing image runs into a gallery row.

    A run of consecutive images is a gallery row on the source (col s12 l2, six
    across). Emitting each as its own full-width image block stacked them and
    roughly doubled the page height.
    """
    out=[]
    i=0
    n=len(blocks)
    while i < n:
        b=blocks[i]
        if b['type']=='image':
            j=i
            while j < n and blocks[j]['type']=='image': j+=1
            run=blocks[i:j]
            if len(run) >= 3:
                items=[]
                for r in run:
                    src=img_path(r.get('src',''))
                    if src:
                        it={'_component':'building-blocks/core-elements/image',
                            'source':src,'alt':r.get('alt','')}
                        if r.get('linkUrl') and r.get('linkText'):
                            it['linkUrl']=local_href(r['linkUrl'])
                            it['linkText']=r['linkText']
                        items.append(it)
                if items:
                    out.append({'_component':'building-blocks/core-elements/image-row',
                                'images':items})
                i=j
                continue
        t=b['type']
        if t=='divider':
            # A divider straight after a heading is already drawn by the
            # heading's own border rule; only free-standing ones are emitted.
            prev=blocks[i-1] if i>0 else None
            if not (prev and prev['type']=='heading'):
                out.append({'_component':'building-blocks/core-elements/divider',
                            'paddingVertical':'none'})
        elif t=='heading': out.append(heading_block(b['text'],b.get('level','h2')))
        elif t in ('paragraph','question'): out.append(text_block(b['text']))
        elif t=='list': out.append(list_block(b['items'],b.get('ordered',False)))
        elif t=='definitionList': out.append(deflist_block(b['items']))
        elif t=='image':
            ib=image_block(b.get('src',''),b.get('alt',''))
            if ib: out.append(ib)
        elif t=='embed':
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
        i+=1
    return out

def custom_section(content,bg,label=''):
    return {'_component':'page-sections/builders/custom-section','label':label,
            'contentSections':content,'maxContentWidth':'xl','paddingHorizontal':'lg',
            'paddingVertical':'xl','colorScheme':'default','backgroundColor':bg}

def clean_href(u):
    u=(u or '').strip()
    if ' ' in u:
        head,_,tail=u.partition('#')
        if tail:
            u=head.split(' ')[0]+'#'+re.sub(r'\s+','-',tail.strip())
        else:
            u=u.split(' ')[0]
    return u

def rewrite_md_links(md):
    def one(m):
        u=clean_href(m.group(1))
        return ']('+rewrite_link(u)+')' if u else m.group(0)
    return re.sub(r'\]\(([^)]*)\)',one,md)

def links_section(sec,bg):
    """Related-links / topics panels.

    Items are prose with links inline ("American Dental Association (ADA).
    [Glossary of Dental Terms](...). 2015"), so use the rich text where the
    parser captured it and fall back to a bare link list otherwise.
    """
    rich=sec.get('richItems') or []
    if rich:
        items=[{'_component':'building-blocks/core-elements/list/list-item',
                'text':rewrite_md_links(x)} for x in rich]
    else:
        items=[{'_component':'building-blocks/core-elements/list/list-item',
                'text':f"[{l['text']}]({rewrite_link(l['url'])})"} for l in sec.get('links',[])]
    content=[]
    if sec.get('heading'): content.append(heading_block(sec['heading'],'h3'))
    if items:
        content.append({'_component':'building-blocks/core-elements/list','listType':'bullet','items':items})
    # "About our business, license, and website security" shares this section
    if sec.get('trustItems'):
        content.append(heading_block(sec.get('trustHeading','About our business'),'h3'))
        content.append({'_component':'building-blocks/core-elements/list','listType':'bullet',
            'items':[{'_component':'building-blocks/core-elements/list/list-item',
                      'text':rewrite_md_links(x)} for x in sec['trustItems']]})
    if not content: return None
    return custom_section(content,bg,sec.get('heading',''))

def convert(sec):
    k=sec['kind']
    bg=BG.get(sec.get('bg',''),'base')
    if k in ('definitions','call-out'): bg='accent'
    if k=='faq-section':
        groups=sec.get('groups') or []
        if not groups:
            qs=[{'text':q.get('question',''),'url':q.get('anchor','')} for q in sec.get('questions',[])]
            qs=[q for q in qs if q['text']]
            if not qs: return None
            groups=[{'heading':sec.get('heading','Questions Answered on This Page'),'questions':qs}]
        content=[]
        for g in groups:
            content.append(heading_block(g['heading'],'h5'))
            items=[]
            for q in g['questions']:
                if isinstance(q,dict):
                    txt,url=q.get('text',''),rewrite_link(clean_href(q.get('url','')))
                else:
                    txt,url=q,''
                label=f"[{txt}]({url})" if url else txt
                items.append({'_component':'building-blocks/core-elements/list/list-item',
                              'text':'Q. '+label})
            content.append({'_component':'building-blocks/core-elements/list','listType':'bullet','items':items})
        return custom_section(content,'surface',groups[0]['heading'])

    if k=='definitions':
        content=[]
        if sec.get('heading'): content.append(heading_block(sec['heading'],'h3'))
        content.append(deflist_block(sec.get('definitions',[])))
        return custom_section(content,bg,sec.get('heading',''))
    if k in ('related-links','related-topics','additional-topics'):
        return links_section(sec,bg)
    if k=='recent-posts':
        return None  # handled by a blog-listing component later
    # page-hero, call-out, main-service-content, facts-and-questions, plain, location-page
    content=[]
    if k=='page-hero' and sec.get('heading'):
        content.append(heading_block(sec['heading'],'h1'))
    content+=blocks_to_content(sec.get('blocks',[]))
    if not content and sec.get('body'):
        content=[text_block(x) for x in sec['body']]
    if not content and sec.get('listItems'):
        content=[list_block(sec['listItems'])]
    if not content: return None
    return custom_section(content,bg,sec.get('heading',''))

def dump_yaml(d):
    if yaml: return yaml.safe_dump(d,sort_keys=False,allow_unicode=True,width=100,default_flow_style=False)
    raise SystemExit("pyyaml required")

def main():
    pages=json.load(open(f"{SC}/parsed-pages.json"))
    n=0; skipped=[]; total_sec=0
    for p in pages:
        secs=[]
        for s in p['sections']:
            c=convert(s)
            if c: secs.append(c)
        if not secs: skipped.append(p['slug']); continue
        fm={'_schema':'default','title':p['title'] or p['slug'],
            'seo':{'title':p['seoTitle'] or '','description':p['seoDescription'] or ''},
            'pageSections':secs}
        total_sec+=len(secs)
        rel=p['permalink'].replace('https://www.ultimatesmiles.com','').strip('/') if p['permalink'] else p['slug']
        path=os.path.join(DEST,(rel or 'index')+'.md')
        if WRITE:
            os.makedirs(os.path.dirname(path),exist_ok=True)
            open(path,'w').write('---\n'+dump_yaml(fm)+'---\n')
        n+=1
    print(f"{'wrote' if WRITE else 'would write'} {n} pages, {total_sec} sections -> {DEST}")
    print(f"skipped (no convertible sections): {len(skipped)}")
    if skipped: print("   "+", ".join(skipped[:20]))

main()
