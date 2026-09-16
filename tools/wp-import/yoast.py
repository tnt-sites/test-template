import re,json,sys
SC=sys.argv[1]
sys.path.insert(0,SC)
d=open(f"{SC}/wpress-db/database.sql",encoding='utf-8',errors='replace').read()
start=d.find("INSERT INTO `SERVMASK_PREFIX_yoast_indexable`")
if start<0: print("no yoast inserts"); sys.exit()
end=start
while True:
    nxt=d.find("INSERT INTO `SERVMASK_PREFIX_", end+10)
    if nxt==-1: end=len(d); break
    if "yoast_indexable`" not in d[nxt:nxt+70]: end=nxt; break
    end=nxt
blk=d[start:end]

def rows(s):
    i=0;n=len(s)
    while i<n:
        if s[i]!='(': i+=1; continue
        j=i+1; depth=1; q=False; cur=''; fields=[]
        while j<n:
            c=s[j]
            if q:
                if c=='\\': cur+=c+s[j+1]; j+=2; continue
                if c=="'": q=False; cur+=c; j+=1; continue
                cur+=c; j+=1; continue
            if c=="'": q=True; cur+=c; j+=1; continue
            if c=='(': depth+=1; cur+=c; j+=1; continue
            if c==')':
                depth-=1
                if depth==0: fields.append(cur); yield fields; i=j+1; break
                cur+=c; j+=1; continue
            if c==',' and depth==1: fields.append(cur); cur=''; j+=1; continue
            cur+=c; j+=1
        else: break
def unq(v):
    v=v.strip()
    if v=='NULL': return ''
    if v.startswith("'") and v.endswith("'"):
        v=v[1:-1]
        for a,b in [("\\'","'"),('\\"','"'),('\\n','\n'),('\\r','\r'),('\\\\','\\')]: v=v.replace(a,b)
    return v
COLS=['id','permalink','permalink_hash','object_id','object_type','object_sub_type','author_id','post_parent','title','description','breadcrumb_title','post_status','is_public','is_protected','has_public_posts','number_of_pages','canonical','primary_focus_keyword']
out={}
for f in rows(blk):
    if len(f)<18: continue
    r={c:unq(f[i]) for i,c in enumerate(COLS)}
    if r['object_type']!='post': continue
    if r['object_sub_type'] not in ('page','post'): continue
    out[r['object_id']]=dict(title=r['title'],description=r['description'],
        canonical=r['canonical'],permalink=r['permalink'],
        breadcrumb=r['breadcrumb_title'],subtype=r['object_sub_type'],
        focus=r['primary_focus_keyword'])
json.dump(out,open(f"{SC}/yoast.json","w"),indent=1)
pg=sum(1 for v in out.values() if v['subtype']=='page')
po=sum(1 for v in out.values() if v['subtype']=='post')
print(f"yoast indexables: {len(out)}  pages={pg} posts={po}")
wd=sum(1 for v in out.values() if v['description'])
wt=sum(1 for v in out.values() if v['title'])
print(f"  with title: {wt}  with description: {wd}")
for k,v in list(out.items())[:4]:
    print(f"  {k}: {v['title'][:60]!r}\n      {v['description'][:70]!r}")
