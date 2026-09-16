"""Parse DB page HTML into structured sections for CloudCannon page front matter."""
import json,re,sys,html
SC=sys.argv[1]

def strip_tags(s):
    # a leading Font Awesome icon marks the Yelp call-out; keep it as a token so
    # the generator can attach a real icon rather than losing it
    s=re.sub(r'<i[^>]*class="[^"]*fa-yelp[^"]*"[^>]*>\s*</i>','\u2063YELP\u2063 ',s)
    # tag boundaries are word boundaries: "<span>About</span>North" -> "About North"
    s=re.sub(r'<(/?)(span|br|b|strong|em|i|div|p|li|dt|dd)\b[^>]*>',' ',s)
    s=re.sub(r'<[^>]+>','',s)
    return html.unescape(re.sub(r'\s+',' ',s)).strip()

def inner(src,start):
    """Return inner HTML of the div whose opening tag starts at `start`."""
    i=src.index('>',start)+1
    depth=1; j=i
    while j<len(src) and depth>0:
        m=re.compile(r'</?div\b',re.I).search(src,j)
        if not m: break
        if src[m.start():m.start()+2]=='</': depth-=1
        else: depth+=1
        j=m.end()
        if depth==0: return src[i:m.start()]
    return src[i:]

def content_blocks(body):
    """Split a section body into ordered heading/prose/list/image blocks."""
    toks=[]
    pat=re.compile(r'<(h[1-6])[^>]*>(.*?)</\1>|<p[^>]*>(.*?)</p>|<(ul|ol)[^>]*>(.*?)</\4>|<dl[^>]*>(.*?)</dl>|<img[^>]*>|<iframe[^>]*>|<div class="[^"]*\bdivider\b[^"]*"[^>]*>\s*</div>',re.S|re.I)
    for m in pat.finditer(body):
        raw=m.group(0)
        if m.group(1):
            t=strip_tags(m.group(2))
            if t: toks.append({'type':'heading','level':m.group(1),'text':t})
        elif m.group(3) is not None:
            inner=m.group(3)
            fr=re.search(r'<iframe[^>]*>',inner,re.I)
            if fr:
                src=re.search(r'src="([^"]*)"',fr.group(0))
                if src:
                    toks.append({'type':'embed','src':src.group(1),
                                 'title':(re.search(r'title="([^"]*)"',fr.group(0)) or [None,''])[1]})
                    continue
            t=md_inline(inner)
            if t:
                cls=re.search(r'class="([^"]*)"',raw)
                toks.append({'type':'question' if cls and 'questions' in cls.group(1) else 'paragraph','text':t})
        elif m.group(4):
            items=[strip_tags(x) for x in re.findall(r'<li[^>]*>(.*?)</li>',m.group(5),re.S)]
            items=[x for x in items if x]
            if items: toks.append({'type':'list','ordered':m.group(4).lower()=='ol','items':items})
        elif m.group(6) is not None:
            pairs=[{'term':strip_tags(a),'definition':strip_tags(b)}
                   for a,b in re.findall(r'<dt[^>]*>(.*?)</dt>\s*<dd[^>]*>(.*?)</dd>',m.group(6),re.S)]
            if pairs: toks.append({'type':'definitionList','items':pairs})
        elif 'divider' in raw and raw.lower().startswith('<div'):
            toks.append({'type':'divider'})
        elif raw.lower().startswith('<iframe'):
            src=re.search(r'src="([^"]*)"',raw)
            if src: toks.append({'type':'embed','src':src.group(1),
                                 'title':(re.search(r'title="([^"]*)"',raw) or [None,''])[1]})
        else:
            src=re.search(r'src="([^"]*)"',raw); alt=re.search(r'alt="([^"]*)"',raw)
            if src: toks.append({'type':'image','src':src.group(1),'alt':alt.group(1) if alt else ''})
    return toks

def kind_of(classes):
    ws=classes.split()
    k=[w for w in ws if w not in ('section-block','z-depth-1','col') and not w.startswith('bg-') and not re.match(r'^[sml]\d+$',w)]
    bgs=[w for w in ws if w.startswith('bg-')]
    return (k[0] if k else 'plain'), (bgs[0] if bgs else '')

def md_inline(frag):
    """Inline HTML -> markdown, keeping <a> links in place."""
    def repl(m):
        href=m.group(1); label=strip_tags(m.group(2)).strip()
        return f"[{label}]({href})" if label else ''
    out=re.sub(r'<a[^>]*href="([^"]*)"[^>]*>(.*?)</a>',repl,frag,flags=re.S)
    out=strip_tags(out)
    out=re.sub(r'\s+([.,;:])',r'\1',out)
    return re.sub(r'\s{2,}',' ',out).strip()

def rich_items(frag):
    """List items as markdown, keeping the prose around each inline link."""
    out=[]
    for li in re.findall(r'<li[^>]*>(.*?)</li>',frag,re.S):
        def repl(m):
            href=m.group(1); label=strip_tags(m.group(2)).strip()
            return f"[{label}]({href})" if label else ''
        md=re.sub(r'<a[^>]*href="([^"]*)"[^>]*>(.*?)</a>',repl,li,flags=re.S)
        md=strip_tags(md)
        md=re.sub(r'\s+([.,;:])',r'\1',md)
        md=re.sub(r'\s{2,}',' ',md).strip()
        if md: out.append(md)
    return out

def links(frag):
    out=[]
    for m in re.finditer(r'<a[^>]*href="([^"]*)"[^>]*>(.*?)</a>',frag,re.S):
        t=strip_tags(m.group(2))
        if t: out.append({'url':m.group(1),'text':t})
    return out

def parse(content):
    secs=[]
    # page hero: .content-block containing the h1
    hm=re.search(r'<div class="([^"]*\bcontent-block\b[^"]*)"',content)
    if hm:
        hb=inner(content,hm.start())
        h1=re.search(r'<h1[^>]*>(.*?)</h1>',hb,re.S)
        if h1:
            hero={'kind':'page-hero','bg':''}
            hero['heading']=strip_tags(h1.group(1))
            sub=re.search(r'<h1[^>]*>.*?</h1>(.*)',hb,re.S)
            hero['blocks']=content_blocks(sub.group(1)) if sub else []
            hero['_pos']=-1  # the hero always leads
            img=re.search(r'<img[^>]*src="([^"]*)"[^>]*>',content[:hm.start()+4000])
            if img: hero['image']=img.group(1)
            secs.append(hero)
    # call-out bands (yelp/phone CTAs) live outside section-block
    for cm in re.finditer(r'<div class="([^"]*\bcall-out\b[^"]*)"',content):
        cb=inner(content,cm.start())
        blocks=content_blocks(cb)
        if blocks:
            bgs=[w for w in cm.group(1).split() if w.startswith('bg-')]
            secs.append({'kind':'call-out','bg':bgs[0] if bgs else '','blocks':blocks,
                         'links':links(cb),'_pos':cm.start()})
    for m in re.finditer(r'<div class="([^"]*\bsection-block\b[^"]*)"',content):
        cls=m.group(1); kind,bg=kind_of(cls)
        body=inner(content,m.start())
        s={'kind':kind,'bg':bg,'_pos':m.start()}
        h=re.search(r'<(h[1-6])[^>]*>(.*?)</\1>',body,re.S)
        if h: s['heading']=strip_tags(h.group(2)); s['headingLevel']=h.group(1)
        # a content section holds a RUN of heading+prose blocks (h2 and h3), not one heading.
        if kind in ('main-service-content','facts-and-questions','location-page','plain'):
            s['blocks']=content_blocks(body)
        if kind=='main-service-content':
            imgs=[{'src':i.group(1),'alt':(re.search(r'alt="([^"]*)"',i.group(0)) or [None,''])[1]}
                  for i in re.finditer(r'<img[^>]*src="([^"]*)"[^>]*>',body)]
            if imgs: s['images']=imgs
            anchor=re.search(r'<a name="([^"]+)"',body)
            if anchor: s['anchor']=anchor.group(1)
            paras=[strip_tags(x) for x in re.findall(r'<p[^>]*>(.*?)</p>',body,re.S)]
            s['body']=[x for x in paras if x]
            # some content sections use <dl> Q/A pairs or <ul> lists instead of <p>
            qa=[{'term':strip_tags(a),'definition':strip_tags(b)}
                for a,b in re.findall(r'<dt[^>]*>(.*?)</dt>\s*<dd[^>]*>(.*?)</dd>',body,re.S)]
            if qa: s['definitionList']=qa
            lis=[strip_tags(x) for x in re.findall(r'<li[^>]*>(.*?)</li>',body,re.S)]
            lis=[x for x in lis if x]
            if lis and not s['body']: s['listItems']=lis
        elif kind=='faq-section':
            s['blocks']=content_blocks(body)
            # the source splits these into two groups under separate headings
            qlinks={}
            for qm in re.finditer(r'<p[^>]*class="[^"]*questions[^"]*"[^>]*>.*?<a[^>]*href="([^"]*)"[^>]*>(.*?)</a>',body,re.S):
                qlinks[strip_tags(qm.group(2))]=qm.group(1)
            groups=[]; cur=None
            for b in s['blocks']:
                if b['type']=='heading':
                    if cur: groups.append(cur)
                    cur={'heading':b['text'],'questions':[]}
                elif b['type'] in ('question','paragraph') and cur is not None:
                    txt=b['text']
                    if txt.startswith('Q.'): txt=txt[2:].strip()
                    if txt: cur['questions'].append({'text':txt,'url':qlinks.get(txt,'')})
            if cur: groups.append(cur)
            if groups: s['groups']=[g for g in groups if g['questions']]
            qs=[]
            for q in re.finditer(r'<p class="questions[^"]*">.*?<a[^>]*href="([^"]*)"[^>]*>(.*?)</a>',body,re.S):
                qs.append({'anchor':q.group(1),'question':strip_tags(q.group(2))})
            if not qs:
                qs=[{'question':strip_tags(a),'answer':strip_tags(b)}
                    for a,b in re.findall(r'<dt[^>]*>(.*?)</dt>\s*<dd[^>]*>(.*?)</dd>',body,re.S)]
                if not qs:
                    qs=[{'question':strip_tags(x)} for x in re.findall(r'<p[^>]*class="questions[^"]*"[^>]*>(.*?)</p>',body,re.S)]
            s['questions']=[q for q in qs if q.get('question')]
        elif kind=='definitions':
            ds=[]
            for d in re.finditer(r'<dt[^>]*>(.*?)</dt>\s*<dd[^>]*>(.*?)</dd>',body,re.S):
                ds.append({'term':strip_tags(d.group(1)),'definition':strip_tags(d.group(2))})
            s['definitions']=ds
        elif kind in ('related-links','related-topics','additional-topics'):
            s['links']=links(body)
            s['richItems']=rich_items(body)
            # .related-links also carries the "About our business, license, and
            # website security" list under its own heading
            hs=re.findall(r'<h[1-6][^>]*>(.*?)</h[1-6]>',body,re.S)
            if len(hs)>1:
                idx=body.find(hs[1])
                tail=body[idx:]
                trust=rich_items(tail)
                if trust:
                    s['trustHeading']=strip_tags(hs[1])
                    s['trustItems']=trust
                    head=body[:idx]
                    s['links']=links(head)
                    s['richItems']=rich_items(head)
        elif kind=='recent-posts':
            sc=re.search(r'\[recent-blogs([^\]]*)\]',body)
            if sc:
                cnt=re.search(r'count=(\d+)',sc.group(1))
                cats=re.search(r'category="([^"]*)"',sc.group(1))
                s['count']=int(cnt.group(1)) if cnt else 4
                s['categories']=cats.group(1).split(',') if cats else []
        if kind in ('facts-and-questions','location-page','plain') or (not any(k in s for k in ('body','questions','definitions','links','count'))):
            paras=[strip_tags(x) for x in re.findall(r'<p[^>]*>(.*?)</p>',body,re.S)]
            paras=[x for x in paras if x]
            if paras: s.setdefault('body',paras)
            qa=[{'question':strip_tags(a),'answer':strip_tags(b)}
                for a,b in re.findall(r'<dt[^>]*>(.*?)</dt>\s*<dd[^>]*>(.*?)</dd>',body,re.S)]
            if qa: s.setdefault('definitionList',qa)
            lk=links(body)
            if lk and 'links' not in s: s['links']=lk
            if 'listItems' not in s:
                lis=[strip_tags(x) for x in re.findall(r'<li[^>]*>(.*?)</li>',body,re.S)]
                lis=[x for x in lis if x]
                if lis: s['listItems']=lis
        secs.append(s)
    # Pages built from plain markup (no section-block wrappers): FAQ, privacy
    # policy, sitemap, services. Treat the whole body as one content run, then
    # split it into a section per top-level heading so it stays editable.
    if not [x for x in secs if x['kind']!='page-hero']:
        body=re.sub(r'<div class="[^"]*page-data[^"]*".*?</section>','',content,flags=re.S)
        blocks=content_blocks(body)
        blocks=[b for b in blocks if not (b['type']=='heading' and secs and b['text']==secs[0].get('heading'))]
        if blocks:
            group=[]; cur=None
            for b in blocks:
                if b['type']=='heading' and b['level'] in ('h1','h2','h3','h4'):
                    if cur and cur['blocks']: group.append(cur)
                    cur={'kind':'plain','bg':'','heading':b['text'],'headingLevel':b['level'],'blocks':[b]}
                else:
                    if cur is None: cur={'kind':'plain','bg':'','blocks':[]}
                    cur['blocks'].append(b)
            if cur and cur['blocks']: group.append(cur)
            secs+=group
    # Call-outs and section-blocks are collected in separate passes, so document
    # order is only restored here. Without this a mid-page call-out ("Schedule a
    # Consultation") is hoisted above the content it follows on the source.
    secs.sort(key=lambda x: x.get('_pos', 0))
    for x in secs: x.pop('_pos', None)
    return secs

if __name__=='__main__':
    pages=json.load(open(f"{SC}/db-pages.json"))
    yo=json.load(open(f"{SC}/yoast.json"))
    out=[]
    for p in pages:
        y=yo.get(str(p['id']),{})
        out.append({'slug':p['slug'],'id':p['id'],'title':p['title'],
                    'seoTitle':y.get('title',''),'seoDescription':y.get('description',''),
                    'permalink':y.get('permalink',''),
                    'sections':parse(p['content'])})
    json.dump(out,open(f"{SC}/parsed-pages.json","w"),indent=1)
    tot=sum(len(o['sections']) for o in out)
    print(f"parsed {len(out)} pages, {tot} sections")
    ex=[o for o in out if o['slug']=='dental-bridges'][0]
    print(f"\n=== /{ex['slug']} ===")
    print("seo:",ex['seoTitle'][:60],"|",ex['seoDescription'][:60])
    for s in ex['sections']:
        extra=''
        for k in ('body','questions','definitions','links'):
            if k in s: extra=f"{k}={len(s[k])}"
        print(f"  {s['kind']:22s} bg={s.get('bg',''):20s} {str(s.get('heading',''))[:36]:36s} {extra}")
