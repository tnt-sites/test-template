import sys, os
HDR=4377
def entries(path):
    with open(path,'rb') as fh:
        while True:
            h=fh.read(HDR)
            if len(h)<HDR or h==b'\x00'*HDR: return
            name=h[0:255].rstrip(b'\x00').decode('utf-8','replace')
            size=int(h[255:269].rstrip(b'\x00').decode() or 0)
            prefix=h[281:4377].rstrip(b'\x00').decode('utf-8','replace')
            yield name,size,prefix,fh.tell()
            fh.seek(size,1)

if __name__=='__main__':
    mode=sys.argv[1]; arc=sys.argv[2]
    if mode=='list':
        from collections import Counter
        c=Counter(); tot=0
        for n,s,p,_ in entries(arc):
            top=p.split('/')[0] if p and p!='.' else '(root)'
            sub='/'.join(p.split('/')[:3]) if p and p!='.' else '(root)'
            c[sub]+=1; tot+=1
        for k,v in c.most_common(30): print(f"{v:7d}  {k}")
        print("TOTAL",tot)
    elif mode=='extract':
        want=sys.argv[3]; dest=sys.argv[4]; n_ok=0
        with open(arc,'rb') as fh:
            for name,size,prefix,off in entries(arc):
                if not prefix.startswith(want): continue
                out=os.path.join(dest,prefix,name)
                os.makedirs(os.path.dirname(out),exist_ok=True)
                fh.seek(off); 
                with open(out,'wb') as o:
                    left=size
                    while left>0:
                        b=fh.read(min(1<<20,left))
                        if not b: break
                        o.write(b); left-=len(b)
                n_ok+=1
                if n_ok%500==0: print("  ...",n_ok,flush=True)
        print("extracted",n_ok)
