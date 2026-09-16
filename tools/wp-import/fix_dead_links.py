"""Point links that 404 on the source at the closest page that does exist.

These are dead on ultimatesmiles.com too - services the practice no longer
lists, or pages that were renamed without the links being updated. Rather than
carrying 404s into the new site, each is sent to its nearest live equivalent.
"""
import glob,re,sys,json
WRITE='--write' in sys.argv

MAP={
 # whitening: several brand-name pages collapsed into the one whitening page
 '/vista-ca/teeth-whitening/':                '/vista-ca/tooth-whitening/',
 '/vista-ca/teeth-whitening-at-dentist/':     '/vista-ca/tooth-whitening/',
 '/vista-ca/professional-teeth-whitening/':   '/vista-ca/tooth-whitening/',
 '/vista-ca/zoom-teeth-whitening/':           '/vista-ca/tooth-whitening/',
 # clear aligners: brand pages -> the clear aligner therapy page
 '/vista-ca/invisalign/':                     '/vista-ca/clear-aligner-therapy/',
 '/vista-ca/invisalign-dentist/':             '/vista-ca/clear-aligner-therapy-dentist/',
 '/vista-ca/does-invisalign-really-work/':    '/vista-ca/does-clear-aligner-therapy-really-work/',
 '/vista-ca/is-invisalign-teen-right-for-my-child/':
                                              '/vista-ca/is-clear-aligner-therapy-teen-right-for-my-child/',
 '/vista-ca/clearcorrect-braces/':            '/vista-ca/clear-braces/',
 '/vista-ca/ez-align/':                       '/vista-ca/clear-aligner-therapy/',
 '/vista-ca/fastbraces/':                     '/vista-ca/clear-braces/',
 # cosmetic services with no page of their own
 '/vista-ca/botox/':                          '/vista-ca/dental-cosmetics/',
 '/vista-ca/juvederm/':                       '/vista-ca/dental-cosmetics/',
 '/vista-ca/lumineers/':                      '/vista-ca/dental-veneers-and-dental-laminates/',
 '/vista-ca/snap-on-smile/':                  '/vista-ca/smile-makeover/',
 '/vista-ca/improve-your-smile-for-senior-pictures/':
                                              '/vista-ca/what-can-i-do-to-improve-my-smile/',
 # implants / equipment
 '/vista-ca/teethxpress/':                    '/vista-ca/implants-vs-mini-implants/',
 '/vista-ca/waterlase-iplus/':                '/vista-ca/laser-dentistry/',
 # specialists without a page
 '/vista-ca/pediatric-dentist/':              '/vista-ca/kid-friendly-dentist/',
 '/vista-ca/pediatric-dentist-vs-general-dentist/':
                                              '/vista-ca/kid-friendly-dentist/',
 '/vista-ca/tmj-dentist/':                    '/vista-ca/night-guards/',
 '/vista-ca/dental-bonding/':                 '/vista-ca/composite-fillings/',
 # flat slug for a nested page
 '/about-find-best-dentist/':                 '/about/find-best-dentist/',
 '/about-find-a-dentist/':                    '/about/find-a-dentist/',
 # astro emits sitemap-index.xml
 '/sitemap.xml':                              '/sitemap-index.xml',
}

files=glob.glob('src/content/pages/**/*.md',recursive=True)+ \
      glob.glob('src/content/blog/*.mdx')+glob.glob('src/data/*.json')
n=0; hits={}
for f in files:
    s=open(f,encoding='utf8').read(); o=s
    for dead,live in MAP.items():
        if dead in s:
            hits[dead]=hits.get(dead,0)+s.count(dead)
            s=s.replace(dead,live)
    if s!=o:
        if WRITE: open(f,'w',encoding='utf8').write(s)
        n+=1
print(f"{'rewrote' if WRITE else 'would rewrite'} {n} files")
for k,v in sorted(hits.items(),key=lambda x:-x[1]):
    print(f"   {v:4d}x {k}  ->  {MAP[k]}")
