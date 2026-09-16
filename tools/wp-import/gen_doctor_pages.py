"""Rebuild the doctor bio pages, which use a different template from the rest.

These pages have no .inner-intro banner: they are an uppercase H1, a full-width
portrait, then bio prose. The generic pipeline mangled them - it dropped the
heading and portrait and turned the pull-quote into a call-out bubble.
"""
import re,html,os,sys,json,yaml
ROOT="/Users/tharvey/Work/CloudCannon/northcounty"
SNAP=f"{ROOT}/wp-migrator/.wpmig/static"
DEST=f"{ROOT}/src/content/pages"
WRITE='--write' in sys.argv
AV=set(os.listdir(f"{ROOT}/src/assets/images/wp"))
SIZED=re.compile(r'^(.*)-(\d{2,4})x(\d{2,4})(\.[a-zA-Z0-9]+)$')
CALL=re.compile(r'\(?760\)?[\s.-]?206[\s.-]?6\d{3}')
LOGOS=re.compile(r'(logo_|MemberLogo|logo-header)',re.I)

def t(s):
    s=re.sub(r'<(/?)(span|br|b|strong|em|i)\b[^>]*>',' ',s)
    out=html.unescape(re.sub(r'\s+',' ',re.sub(r'<[^>]+>','',s))).strip()
    return CALL.sub('(760) 940-2273',out)

def local(src):
    b=os.path.basename((src or '').split('?')[0]); z=SIZED.match(b)
    for c in ((z.group(1)+z.group(4)) if z else b, b):
        if c in AV: return f"/src/assets/images/wp/{c}"
    return None

PAGES={'meet-dr-craig-huenergardt':'meet-dr-craig-huenergardt',
       'meet-dr-henninger':'meet-dr-henninger'}

def build(slug):
    h=re.sub(r'<(style|script)\b.*?</\1>','',
             open(f"{SNAP}/{slug}.html",encoding='utf8',errors='replace').read(),flags=re.S|re.I)
    m=re.search(r'<div class="entry-content">(.*?)(?=<footer|<div class="fixed-tabs)',h,re.S)
    body=m.group(1) if m else h
    h1=re.search(r'<h1[^>]*>(.*?)</h1>',body,re.S)
    title=t(h1.group(1)) if h1 else slug.replace('-',' ').title()
    portrait=None
    for src in re.findall(r'<img[^>]*src="([^"?]+)"',body):
        if LOGOS.search(src): continue
        p=local(src)
        if p: portrait=p; break
    blocks=[]
    pat=re.compile(r'<(h[2-5])[^>]*>(.*?)</\1>|<p[^>]*>(.*?)</p>|<(ul|ol)[^>]*>(.*?)</\4>',re.S|re.I)
    for mm in pat.finditer(body):
        if mm.group(1):
            x=t(mm.group(2))
            if x: blocks.append({'_component':'building-blocks/core-elements/heading',
                                 'text':x,'level':'h2','size':'md'})
        elif mm.group(3) is not None:
            x=t(mm.group(3))
            if x and len(x)>1: blocks.append({'_component':'building-blocks/core-elements/text','text':x})
        elif mm.group(4):
            items=[t(i) for i in re.findall(r'<li[^>]*>(.*?)</li>',mm.group(5),re.S)]
            items=[i for i in items if i]
            if items: blocks.append({'_component':'building-blocks/core-elements/list','listType':'bullet',
                'items':[{'_component':'building-blocks/core-elements/list/list-item','text':i} for i in items]})
    return title,portrait,blocks

def main():
    yo=json.load(open(f"{sys.argv[1]}/yoast.json"))
    pages={p['slug']:p for p in json.load(open(f"{sys.argv[1]}/db-pages.json"))}
    for slug,out in PAGES.items():
        if not os.path.isfile(f"{SNAP}/{slug}.html"): print("  no snapshot:",slug); continue
        title,portrait,blocks=build(slug)
        secs=[{'_component':'page-sections/builders/custom-section','label':title,
               'contentSections':([{'_component':'building-blocks/core-elements/heading',
                    'text':title,'level':'h1','size':'2xl','alignX':'center'}]
                 +([{'_component':'building-blocks/core-elements/image',
                     'source':portrait,'alt':title}] if portrait else [])
                 +blocks),
               'maxContentWidth':'xl','paddingHorizontal':'lg','paddingVertical':'xl',
               'colorScheme':'default','backgroundColor':'base'},
              {'_component':'page-sections/forms/liine-form','formId':'251056297507965',
               'heading':'Request an Appointment','subtext':'',
               'title':'North County Cosmetic and Implant Dentistry - Request an Appointment Form',
               'height':539,'backgroundColor':'surface'}]
        p=pages.get(out,{}); y=yo.get(str(p.get('id')),{}) if p else {}
        fm={'_schema':'default','title':p.get('title') or title.title(),
            'seo':{'title':y.get('title',''),'description':y.get('description','')},
            'pageSections':secs}
        if WRITE:
            open(f"{DEST}/{out}.md",'w',encoding='utf8').write(
                '---\n'+yaml.safe_dump(fm,sort_keys=False,allow_unicode=True,width=100)+'---\n')
        print(f"  {out:32s} h1={title[:34]!r} portrait={'y' if portrait else 'n'} blocks={len(blocks)}")
    print("wrote" if WRITE else "dry run")

main()
