import re,json,sys
SC=sys.argv[1]
d=open(f"{SC}/wpress-db/database.sql",encoding='utf-8',errors='replace').read()
start=d.find("INSERT INTO `SERVMASK_PREFIX_posts`")
end=start
while True:
    nxt=d.find("INSERT INTO `SERVMASK_PREFIX_", end+10)
    if nxt==-1: end=len(d); break
    if "_posts`" not in d[nxt:nxt+60]: end=nxt; break
    end=nxt
blk=d[start:end]

def rows(s):
    """Yield each VALUES(...) tuple, respecting quotes/escapes."""
    i=0; n=len(s)
    while i<n:
        if s[i]!='(': i+=1; continue
        j=i+1; depth=1; q=False; out=[]
        cur=''; fields=[]
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
                if depth==0:
                    fields.append(cur); yield fields; i=j+1; break
                cur+=c; j+=1; continue
            if c==',' and depth==1: fields.append(cur); cur=''; j+=1; continue
            cur+=c; j+=1
        else: break

def unq(v):
    v=v.strip()
    if v.startswith("'") and v.endswith("'"):
        v=v[1:-1]
        v=v.replace("\\'","'").replace('\\"','"').replace('\\n','\n').replace('\\r','\r').replace('\\\\','\\')
    return v

pages=[]; posts=[]
for f in rows(blk):
    if len(f)<21: continue
    try:
        pid=int(unq(f[0]))
    except: continue
    content=unq(f[4]); title=unq(f[5]); status=unq(f[7])
    name=unq(f[11]); ptype=unq(f[20]); date=unq(f[2]); excerpt=unq(f[6]); parent=unq(f[17])
    rec=dict(id=pid,title=title,slug=name,status=status,type=ptype,date=date,parent=parent,content=content,excerpt=excerpt)
    if ptype=='page': pages.append(rec)
    elif ptype=='post': posts.append(rec)
json.dump(pages,open(f"{SC}/db-pages.json","w"))
json.dump(posts,open(f"{SC}/db-posts.json","w"))
print("pages:",len(pages)," published:",sum(1 for p in pages if p['status']=='publish'))
print("posts:",len(posts)," published:",sum(1 for p in posts if p['status']=='publish'))
print("\n=== sample pages ===")
for p in [x for x in pages if x['status']=='publish'][:8]:
    print(f"  {p['id']:6d} /{p['slug'][:45]:45s} {len(p['content']):7d} chars  {p['title'][:40]}")
