"""Convert DB blog posts -> .mdx in src/content/blog, preserving root-level URLs."""
import json,sys,os,re,html
SC=sys.argv[1]; DEST=sys.argv[2]; WRITE='--write' in sys.argv
IMGDIR="/Users/tharvey/Work/CloudCannon/northcounty/src/assets/images/wp"
AVAIL=set(os.listdir(IMGDIR)) if os.path.isdir(IMGDIR) else set()
SIZED=re.compile(r'^(.*)-(\d{2,4})x(\d{2,4})(\.[a-zA-Z0-9]+)$')

def local_img(src):
    m=re.search(r'/wp-content/uploads/(.+)$',src.split('?')[0])
    if not m: return None
    base=os.path.basename(m.group(1))
    s=SIZED.match(base); cand=(s.group(1)+s.group(4)) if s else base
    for c in (cand,base):
        if c in AVAIL: return f"/src/assets/images/wp/{c}"
    return None

def clean_url(u):
    u=resolve_placeholders(u)
    u=u.replace('https://www.ultimatesmiles.com','').replace('http://www.ultimatesmiles.com','')
    return u or '/'

# unreplaced CMS template tokens found in the source content
PLACEHOLDERS={
 'URLYelp':'https://www.yelp.com/biz/north-county-cosmetic-and-implant-dentistry-vista-2',
 'URLGoogle':'https://www.google.com/maps',
 'URLFacebook':'https://www.facebook.com/',
}
def resolve_placeholders(t):
    # the source stores these entity-encoded inside attributes: &lt;&lt;URLYelp&gt;&gt;
    t=t.replace('&lt;&lt;','<<').replace('&gt;&gt;','>>')
    def r(m):
        return PLACEHOLDERS.get(m.group(1),'')
    return re.sub(r'<<([A-Za-z0-9_]+)>>',r,t)

def mdx_safe(t):
    """MDX parses < and { as JSX. Escape any that are not real markdown/HTML."""
    t=re.sub(r'<(?![a-zA-Z/!])',r'\\<',t)
    t=t.replace('{','\\{').replace('}','\\}')
    return t

def to_md(h):
    h=h.replace('\r\n','\n').replace('\r','\n')
    h=resolve_placeholders(h)
    h=re.sub(r'<!--.*?-->','',h,flags=re.S)
    h=re.sub(r'<(script|style)\b.*?</\1>','',h,flags=re.S|re.I)
    # images -> markdown (drop wrapping links to the raw upload)
    def img(m):
        src=re.search(r'src="([^"]*)"',m.group(0)); alt=re.search(r'alt="([^"]*)"',m.group(0))
        if not src: return ''
        p=local_img(src.group(1))
        return f"![{alt.group(1) if alt else ''}]({p})" if p else ''
    h=re.sub(r'<a[^>]*>\s*(<img[^>]*>)\s*</a>',lambda m: img(m), h, flags=re.S)
    h=re.sub(r'<img[^>]*>',img,h)
    # links
    def a(m):
        href=re.search(r'href="([^"]*)"',m.group(0))
        t=re.sub(r'<[^>]+>','',m.group(2)).strip()
        if not t: return ''
        return f"[{t}]({clean_url(href.group(1))})" if href else t
    h=re.sub(r'<a([^>]*)>(.*?)</a>',a,h,flags=re.S)
    for i in range(6,0,-1):
        h=re.sub(rf'<h{i}[^>]*>(.*?)</h{i}>',lambda m:'\n'+'#'*i+' '+re.sub(r'<[^>]+>','',m.group(1)).strip()+'\n',h,flags=re.S)
    h=re.sub(r'<(strong|b)[^>]*>(.*?)</\1>',lambda m:'**'+re.sub(r'<[^>]+>','',m.group(2)).strip()+'**',h,flags=re.S)
    h=re.sub(r'<(em|i)[^>]*>(.*?)</\1>',lambda m:'*'+re.sub(r'<[^>]+>','',m.group(2)).strip()+'*',h,flags=re.S)
    h=re.sub(r'<li[^>]*>(.*?)</li>',lambda m:'- '+re.sub(r'<[^>]+>','',m.group(1)).strip()+'\n',h,flags=re.S)
    h=re.sub(r'</?(ul|ol)[^>]*>','\n',h)
    h=re.sub(r'<p[^>]*>(.*?)</p>',lambda m:'\n'+m.group(1).strip()+'\n',h,flags=re.S)
    h=re.sub(r'<br\s*/?>','\n',h)
    # Strip the remaining tags, but never across a blank line. The source has
    # malformed fragments (a bare `</` in mini-vs-regular-dental-implants), and
    # a greedy `<[^>]+>` runs from one of those to the next `>` thousands of
    # characters later - that ate four headings and their paragraphs.
    # `[^<>]*` stops at the next `<`, so a malformed fragment drops itself
    # instead of the paragraphs after it. mdx_safe escapes whatever is left.
    h=re.sub(r'<[^<>]*>','',h)
    h=re.sub(r'</(?=\s|$)','',h)
    h=html.unescape(h)
    h=re.sub(r'[ \t]+\n','\n',h)
    h=re.sub(r'\n{3,}','\n\n',h)
    return mdx_safe(h.strip())

def first_image(content):
    for m in re.finditer(r'<img[^>]*src="([^"]*)"',content):
        p=local_img(m.group(1))
        if p: return p
    return None

def yaml_str(s):
    s=(s or '').replace('\\','\\\\').replace('"','\\"').replace('\n',' ').strip()
    return '"'+s+'"'

def main():
    posts=json.load(open(f"{SC}/db-posts.json"))
    yo=json.load(open(f"{SC}/yoast.json"))
    n=0; noimg=0
    for p in posts:
        y=yo.get(str(p['id']),{})
        body=to_md(p['content'])
        if not body.strip(): continue
        desc=y.get('description') or ''
        if not desc:
            plain=body
            plain=re.sub(r'!\[[^\]]*\]\([^)]*\)','',plain)      # drop images
            plain=re.sub(r'\[([^\]]*)\]\([^)]*\)',r'\1',plain)   # links -> their text
            plain=re.sub(r'^#{1,6}\s+.*$','',plain,flags=re.M)    # drop headings
            plain=re.sub(r'[*_`>]','',plain)
            plain=re.sub(r'\s+',' ',plain).strip()
            desc=(plain[:152].rsplit(' ',1)[0]+'...') if len(plain)>155 else plain
        img=first_image(p['content'])
        if not img: noimg+=1
        fm=['---','_schema: default',f'title: {yaml_str(p["title"])}',
            f'description: {yaml_str(desc)}',
            f'date: {p["date"].replace(" ","T")}Z',
            'author: North County Cosmetic and Implant Dentistry']
        if img: fm.append(f'image: {img}')
        fm.append('---')
        out='\n'.join(fm)+'\n\n'+body+'\n'
        if WRITE:
            os.makedirs(DEST,exist_ok=True)
            open(os.path.join(DEST,p['slug']+'.mdx'),'w').write(out)
        n+=1
    print(f"{'wrote' if WRITE else 'would write'} {n} posts ({noimg} without an image) -> {DEST}")
main()
