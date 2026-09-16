import sys,os,re
sys.path.insert(0,'/private/tmp/claude-501/-Users-tharvey-Work-CloudCannon-northcounty/fdb7a81a-57ec-4eee-aadb-b03a080cf26e/scratchpad')
from wpress import entries, HDR
def clean(p):
    p=p.replace('\x00','').strip()
    return '/'.join(re.sub(r'[0-9a-f]{8}$','',s) for s in p.split('/'))
arc,want,dest=sys.argv[1],sys.argv[2],sys.argv[3]
n=0; total=0
with open(arc,'rb') as fh:
    for name,size,prefix,off in entries(arc):
        cp=clean(prefix); name=name.replace('\x00','').strip()
        if not (cp==want or cp.startswith(want+'/')): continue
        out=os.path.join(dest,cp,name)
        os.makedirs(os.path.dirname(out),exist_ok=True)
        fh.seek(off)
        with open(out,'wb') as o:
            left=size
            while left>0:
                b=fh.read(min(1<<20,left))
                if not b: break
                o.write(b); left-=len(b)
        n+=1; total+=size
        if n%500==0: print("  ...",n,flush=True)
print(f"extracted {n} files, {total/1e6:.1f} MB -> {dest}/{want}")
