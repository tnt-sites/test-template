"""Extract page content from rendered snapshot HTML for theme-built pages."""
import re,html,json,sys,os
SC=sys.argv[1] if len(sys.argv)>1 else ''
STATIC=sys.argv[2] if len(sys.argv)>2 else ''

CALL_TRACKING=re.compile(r'\(?760\)?[\s.-]?206[\s.-]?6\d{3}')
REAL_PHONE='(760) 940-2273'

def t(s):
    # insert a space at tag boundaries first: "<span>About</span>North County" must
    # not collapse to "AboutNorth County"
    s=re.sub(r'<(/?)(span|br|b|strong|em|i|div|p|li)\b[^>]*>',' ',s)
    out=html.unescape(re.sub(r'\s+',' ',re.sub(r'<[^>]+>','',s))).strip()
    # 760-206-6xxx numbers are call-tracking, rotating per visitor
    return CALL_TRACKING.sub(REAL_PHONE,out)

# chrome that appears on every page and must not become page content
CHROME_RE=re.compile(r'(menu-item|main-nav|side-nav|top-nav|footer|copyright|breadcrumb|'
                     r'inner-topbar|dropdown|social|schema|cookie|cmplz|skip-link)',re.I)

def strip_chrome(h):
    h=re.sub(r'<(script|style|noscript|svg)\b.*?</\1>','',h,flags=re.S|re.I)
    h=re.sub(r'<!--.*?-->','',h,flags=re.S)
    h=re.sub(r'<(nav|header|footer)\b.*?</\1>','',h,flags=re.S|re.I)
    return h

def inner(src,start):
    tag=re.match(r'<(\w+)',src[start:]).group(1)
    i=src.index('>',start)+1
    depth=1; j=i
    pat=re.compile(rf'</?{tag}\b',re.I)
    while j<len(src):
        m=pat.search(src,j)
        if not m: break
        if src[m.start():m.start()+2]=='</':
            depth-=1
            if depth==0: return src[i:m.start()]
        else: depth+=1
        j=m.end()
    return src[i:]

def pairs_from(html_src,imgmap):
    """Before/after rows: .gallery-two-images with .col.before and .col.after."""
    out=[]
    for m in re.finditer(r'<div class="[^"]*gallery-two-images[^"]*".*?(?=<div class="[^"]*gallery-two-images|$)',html_src,re.S):
        blk=m.group(0)
        b=re.search(r'class="[^"]*\bbefore\b[^"]*".*?<img[^>]*?(?:data-src|src)="([^"?]+)"[^>]*?(?:alt="([^"]*)")?',blk,re.S)
        a=re.search(r'class="[^"]*\bafter\b[^"]*".*?<img[^>]*?(?:data-src|src)="([^"?]+)"[^>]*?(?:alt="([^"]*)")?',blk,re.S)
        if not (b and a): continue
        bs=imgmap(b.group(1)); as_=imgmap(a.group(1))
        if bs and as_ and bs!=as_:
            out.append({'beforeSource':bs,'beforeAlt':(b.group(2) or ''),
                        'afterSource':as_,'afterAlt':(a.group(2) or '')})
    # dedupe, keep order
    seen=set(); uniq=[]
    for p in out:
        k=(p['beforeSource'],p['afterSource'])
        if k in seen: continue
        seen.add(k); uniq.append(p)
    return uniq

def infocards_from(html_src,imgmap):
    """Image + title + prose cards (.policy-wrapper, .service-wrapper, .grid-item)."""
    out=[]
    pat=re.compile(r'<div class="[^"]*(?:policy-wrapper|service-wrapper|profile-wrap)[^"]*"(.*?)(?=<div class="[^"]*(?:policy-wrapper|service-wrapper|profile-wrap)|</section>|$)',re.S)
    for m in pat.finditer(html_src):
        blk=m.group(1)
        img=re.search(r'<img[^>]*?(?:data-src|src)="([^"?]+)"',blk)
        alt=re.search(r'<img[^>]*?alt="([^"]*)"',blk)
        ttl=re.search(r'<h[1-6][^>]*>(.*?)</h[1-6]>',blk,re.S)
        ps=[t(x) for x in re.findall(r'<p[^>]*>(.*?)</p>',blk,re.S)]
        ps=[x for x in ps if x]
        title=t(ttl.group(1)) if ttl else ''
        src=imgmap(img.group(1)) if img else None
        if title and (src or ps):
            a=re.search(r'<a[^>]*href="([^"#][^"]*)"[^>]*class="[^"]*b(?:tn|utton)[^"]*"[^>]*>(.*?)</a>',blk,re.S|re.I) \
              or re.search(r'<a[^>]*class="[^"]*b(?:tn|utton)[^"]*"[^>]*href="([^"#][^"]*)"[^>]*>(.*?)</a>',blk,re.S|re.I)
            card={'image':src or '','imageAlt':(alt.group(1) if alt else ''),
                  'title':title,'description':' '.join(ps)[:600]}
            if a:
                card['linkUrl']=a.group(1); card['linkText']=t(a.group(2))[:40]
            out.append(card)
    seen=set(); uniq=[]
    for c in out:
        if c['title'] in seen: continue
        seen.add(c['title']); uniq.append(c)
    return uniq

def cards_from(frag,imgmap):
    """Linked image cards: <a href><figure><img><figcaption><h*>Label</h*>."""
    cards=[]
    for m in re.finditer(r'<a[^>]*href="([^"]+)"[^>]*>\s*<figure.*?</figure>\s*</a>',frag,re.S|re.I):
        blk=m.group(0)
        img=re.search(r'(?:data-src|src)="([^"?]+)"',blk)
        cap=re.search(r'<figcaption.*?>(.*?)</figcaption>',blk,re.S|re.I)
        label=t(cap.group(1)) if cap else ''
        src=imgmap(img.group(1)) if img else None
        if label and src:
            cards.append({'title':label,'url':m.group(1),'image':src})
    return cards

def blocks_from(frag,imgmap):
    out=[]
    pat=re.compile(r'<(h[1-6])[^>]*>(.*?)</\1>|<p[^>]*>(.*?)</p>|<(ul|ol)[^>]*>(.*?)</\4>|<img[^>]*>|<iframe[^>]*>',re.S|re.I)
    for m in pat.finditer(frag):
        raw=m.group(0)
        if m.group(1):
            x=t(m.group(2))
            if x: out.append({'type':'heading','level':m.group(1),'text':x})
        elif m.group(3) is not None:
            x=t(m.group(3))
            if x and len(x)>1: out.append({'type':'paragraph','text':x})
        elif m.group(4):
            items=[t(i) for i in re.findall(r'<li[^>]*>(.*?)</li>',m.group(5),re.S)]
            items=[i for i in items if i]
            if items: out.append({'type':'list','ordered':m.group(4).lower()=='ol','items':items})
        elif raw.lower().startswith('<iframe'):
            # videos: snap_pages never matched <iframe>, so the reviews page lost
            # all 15 of its patient videos
            src=re.search(r'src="([^"]*)"',raw)
            if src: out.append({'type':'embed','src':src.group(1),
                                'title':(re.search(r'title="([^"]*)"',raw) or [None,''])[1]})
        else:
            src=re.search(r'(?:data-src|src)="([^"]*)"',raw); alt=re.search(r'alt="([^"]*)"',raw)
            if src:
                p=imgmap(src.group(1))
                if p: out.append({'type':'image','src':p,'alt':alt.group(1) if alt else ''})
    return out

def extract(path,imgmap):
    h=strip_chrome(open(path,encoding='utf8',errors='replace').read())
    body=re.search(r'<body[^>]*>(.*)</body>',h,re.S)
    h=body.group(1) if body else h
    secs=[]
    # take top-level <section> and content divs, skipping chrome-classed ones
    for m in re.finditer(r'<(section|div)[^>]*class="([^"]*)"',h):
        cls=m.group(2)
        if CHROME_RE.search(cls): continue
        if not re.search(r'section|container|content|block|row|wrapper|details|entry|grid|column',cls,re.I): continue
        frag=inner(h,m.start())
        if len(frag)>60000: continue
        if re.search(r'accred|badge|affiliation|logo-strip|associations',cls,re.I): continue
        cards=cards_from(frag,imgmap)
        bl=blocks_from(frag,imgmap)
        if len(cards)>=3:
            # drop the loose heading/image blocks the cards already cover
            titles={c['title'] for c in cards}; srcs={c['image'] for c in cards}
            bl=[b for b in bl if not (b['type']=='heading' and b['text'] in titles)
                              and not (b['type']=='image' and b.get('src') in srcs)]
            bl.append({'type':'cards','items':cards})
        LOGOS=re.compile(r'(logo_|MemberLogo|logo-header|ADA|ADSA|AGD|CDA)',re.I)
        bl=[b for b in bl if not (b['type']=='image' and LOGOS.search(b.get('src','')))]
        txt=[b for b in bl if b['type'] in ('heading','paragraph','list')]
        img=[b for b in bl if b['type']=='image']
        # keep text sections, and image-only sections (galleries)
        if len(txt)<2 and len(img)<3: continue
        secs.append({'cls':cls,'blocks':bl,'len':len(frag)})
    # drop sections fully contained in an earlier one (outer wrappers duplicate)
    def sig(s):
        return {(b['type'],b.get('text','') or b.get('src','') or str(b.get('items'))[:60])
                for b in s['blocks']}
    def textsig(s):
        return {b.get('text','') for b in s['blocks'] if b['type'] in ('heading','paragraph')}
    secs.sort(key=lambda s:-len(s['blocks']))
    out=[]
    for s in secs:
        g=sig(s)
        if any(g and g <= sig(k) for k in out): continue   # fully contained in a kept section
        tg=textsig(s)
        if tg and any(tg <= textsig(k) for k in out): continue
        out.append(s)
    # restore document order
    out.sort(key=lambda s:secs.index(s) if s in secs else 0)
    return out
