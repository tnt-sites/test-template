"""Rebuild the site navigation from the WP nav_menu_item posts + postmeta."""
import re,json,sys
SC=sys.argv[1]
d=open(f"{SC}/wpress-db/database.sql",encoding='utf-8',errors='replace').read()

def rows(blk):
    i=0;n=len(blk)
    while i<n:
        if blk[i]!='(': i+=1; continue
        j=i+1;depth=1;q=False;cur='';f=[]
        while j<n:
            c=blk[j]
            if q:
                if c=='\\': cur+=c+blk[j+1]; j+=2; continue
                if c=="'": q=False;cur+=c;j+=1;continue
                cur+=c;j+=1;continue
            if c=="'": q=True;cur+=c;j+=1;continue
            if c=='(': depth+=1;cur+=c;j+=1;continue
            if c==')':
                depth-=1
                if depth==0: f.append(cur); yield f; i=j+1; break
                cur+=c;j+=1;continue
            if c==',' and depth==1: f.append(cur);cur='';j+=1;continue
            cur+=c;j+=1
        else: break
def unq(v):
    v=v.strip()
    if v=='NULL': return ''
    if v.startswith("'") and v.endswith("'"):
        v=v[1:-1]
        for a,b in [("\\'","'"),('\\"','"'),('\\n','\n'),('\\r','\r'),('\\\\','\\')]: v=v.replace(a,b)
    return v
def block(table):
    start=d.find(f"INSERT INTO `SERVMASK_PREFIX_{table}`")
    if start<0: return ''
    end=start
    while True:
        nxt=d.find("INSERT INTO `SERVMASK_PREFIX_", end+10)
        if nxt==-1: return d[start:]
        if f"_{table}`" not in d[nxt:nxt+70]: return d[start:nxt]
        end=nxt

# nav_menu_item posts: id, title(5), menu_order(18), type(20), parent(17)
items={}
for f in rows(block('posts')):
    if len(f)<21: continue
    if unq(f[20])!='nav_menu_item': continue
    try: pid=int(unq(f[0]))
    except: continue
    items[pid]={'id':pid,'order':int(unq(f[19]) or 0),'title':unq(f[5]),'meta':{}}

# postmeta: meta_id, post_id, meta_key, meta_value
for f in rows(block('postmeta')):
    if len(f)<4: continue
    try: pid=int(unq(f[1]))
    except: continue
    if pid in items:
        items[pid]['meta'][unq(f[2])]=unq(f[3])

# resolve object ids -> slugs/permalinks
yo=json.load(open(f"{SC}/yoast.json"))
pages={p['id']:p for p in json.load(open(f"{SC}/db-pages.json"))}
def url_for(it):
    m=it['meta']
    t=m.get('_menu_item_type')
    if t=='custom': return m.get('_menu_item_url','')
    oid=m.get('_menu_item_object_id')
    if oid:
        y=yo.get(str(oid))
        if y and y.get('permalink'):
            return y['permalink'].replace('https://www.ultimatesmiles.com','') or '/'
        p=pages.get(int(oid)) if oid.isdigit() else None
        if p: return '/'+p['slug']+'/'
    return ''
def label(it):
    return it['meta'].get('_menu_item_title') or it['title'] or ''

nodes={}
for pid,it in items.items():
    nodes[pid]={'name':label(it),'path':url_for(it),'children':[],
                '_parent':int(it['meta'].get('_menu_item_menu_item_parent') or 0),
                '_order':it['order']}
roots=[]
for pid,n in nodes.items():
    p=n['_parent']
    if p and p in nodes: nodes[p]['children'].append(n)
    else: roots.append(n)
def clean(ns):
    ns.sort(key=lambda x:x['_order'])
    out=[]
    for n in ns:
        c=clean(n['children'])
        o={'name':n['name'],'path':n['path']}
        o['children']=c
        if o['name'] and o['path']: out.append(o)
    return out
nav=clean(roots)
print(f"menu items: {len(items)}  roots: {len(nav)}")
json.dump(nav,open(f"{SC}/nav.json","w"),indent=1)
def show(ns,i=0):
    for n in ns:
        print('  '*i+f"- {n['name']}  -> {n['path']}")
        show(n['children'],i+1)
show(nav)
