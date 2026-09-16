"""Map parsed WP sections -> CloudCannon page front matter using the starter's components."""
import json,sys,os,re
try:
    import yaml
except ImportError:
    yaml=None

SC=sys.argv[1]; DEST=sys.argv[2]
WRITE='--write' in sys.argv

# WP background class -> starter backgroundColor token
BG={'bg-primary':'accent','bg-secondary':'surface','bg-body-complement':'base',
    'bg-mute':'surface','bg-body-mute':'surface','bg-tertiary':'highlight','':'base'}

IMG_RE=re.compile(r'^https?://(?:www\.)?ultimatesmiles\.com/wp-content/uploads/(.+)$')
AVAILABLE=set(os.listdir("/Users/tharvey/Work/CloudCannon/northcounty/src/assets/images/wp")) \
    if os.path.isdir("/Users/tharvey/Work/CloudCannon/northcounty/src/assets/images/wp") else set()
SIZED=re.compile(r'^(.*)-(\d{2,4})x(\d{2,4})(\.[a-zA-Z0-9]+)$')

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

def rewrite_link(url):
    """Map old WP URLs onto the new site's routes."""
    if not url: return url
    u=url.replace('https://www.ultimatesmiles.com','').replace('http://www.ultimatesmiles.com','')
    if u.startswith('/vista-ca/'): return u
    return u

def text_block(t): return {'_component':'building-blocks/core-elements/text','text':t}
def heading_block(t,level='h2'):
    return {'_component':'building-blocks/core-elements/heading','text':t,'level':level,'size':'md'}
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
    out=[]
    for b in blocks:
        t=b['type']
        if t=='heading': out.append(heading_block(b['text'],b.get('level','h2')))
        elif t in ('paragraph','question'): out.append(text_block(b['text']))
        elif t=='list': out.append(list_block(b['items'],b.get('ordered',False)))
        elif t=='definitionList': out.append(deflist_block(b['items']))
        elif t=='image':
            ib=image_block(b.get('src',''),b.get('alt',''))
            if ib: out.append(ib)
    return out

def custom_section(content,bg,label=''):
    return {'_component':'page-sections/builders/custom-section','label':label,
            'contentSections':content,'maxContentWidth':'xl','paddingHorizontal':'lg',
            'paddingVertical':'4xl','colorScheme':'default','backgroundColor':bg}

def links_section(sec,bg):
    items=[{'_component':'building-blocks/core-elements/list/list-item',
            'text':f"[{l['text']}]({rewrite_link(l['url'])})"} for l in sec.get('links',[])]
    content=[]
    if sec.get('heading'): content.append(heading_block(sec['heading'],'h3'))
    content.append({'_component':'building-blocks/core-elements/list','listType':'bullet','items':items})
    return custom_section(content,bg,sec.get('heading',''))

def convert(sec):
    bg=BG.get(sec.get('bg',''),'base')
    k=sec['kind']
    if k=='faq-section':
        items=[]
        for q in sec.get('questions',[]):
            ans=q.get('answer','')
            items.append({'_component':'building-blocks/wrappers/accordion/accordion-item',
                          'title':q.get('question',''),
                          'contentSections':[text_block(ans)] if ans else []})
        if not items: return None
        return {'_component':'page-sections/info-blocks/faq-section',
                'heading':sec.get('heading','Questions Answered on This Page'),
                'headingLevel':'h2','headingSize':'lg','singleOpen':True,'openFirst':False,
                'items':items,'maxContentWidth':'xl','paddingHorizontal':'xl',
                'paddingVertical':'4xl','colorScheme':'default','backgroundColor':bg}
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
