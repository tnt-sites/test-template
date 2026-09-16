"""Apply the source's section styling. Runs last, after all generation."""
import glob,yaml,sys
WRITE='--write' in sys.argv

def style(seclist):
    ch=False
    for sec in seclist:
        comp=sec.get('_component','')
        if comp=='page-sections/builders/content-with-sidebar':
            ch=style(sec.get('main') or []) or ch
            ch=style(sec.get('sidebar') or []) or ch
            continue
        if comp!='page-sections/builders/custom-section': continue
        cs=sec.get('contentSections') or []
        has_def=any('definition-list' in (c.get('_component') or '') for c in cs)
        has_list=any('core-elements/list' in (c.get('_component') or '') for c in cs)
        texts=[c for c in cs if 'core-elements/text' in (c.get('_component') or '')]
        headings=[c for c in cs if 'core-elements/heading' in (c.get('_component') or '')]
        # a call-out: one short paragraph, optionally with a heading, no list
        is_callout=(not has_list and not has_def and len(texts)==1
                    and len(cs)<=2
                    and len((texts[0].get('text') or ''))<320)
        before=(sec.get('backgroundColor'),sec.get('class'))
        if has_def:
            sec['backgroundColor']='accent'; sec.pop('class',None)
        elif is_callout:
            sec['class']='callout-bubble'; sec['backgroundColor']='none'
            sec['paddingVertical']='none'; sec['maxContentWidth']='none'
            sec['paddingHorizontal']='none'
        else:
            sec['backgroundColor']='surface'; sec.pop('class',None)
        if (sec.get('backgroundColor'),sec.get('class'))!=before: ch=True
    return ch

n=0
for f in glob.glob('src/content/pages/vista-ca/*.md'):
    raw=open(f,encoding='utf8').read(); parts=raw.split('---\n')
    if len(parts)<3: continue
    d=yaml.safe_load(parts[1])
    if style(d.get('pageSections') or []):
        if WRITE:
            open(f,'w',encoding='utf8').write('---\n'+yaml.safe_dump(d,sort_keys=False,allow_unicode=True,width=100)+'---\n')
        n+=1
print(f"{'styled' if WRITE else 'would style'} {n} pages")
