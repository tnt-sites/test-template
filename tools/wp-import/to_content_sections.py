"""Replace the generic builders/custom-section wrappers with named components.

The content inside these wrappers is almost always heading + prose, heading +
list, or heading + Q/A pairs, nested six levels deep. The wrappers themselves
carry real visual state (background colour, and a spacing combination that is
one of exactly three presets), which is preserved rather than dropped -- the
new components render the same `.custom-section > .outer-content > .content`
markup, because ~43 rules in _source-design.pcss target those selectors.

This rewrites each recognised wrapper into one of four flat components, so a
future dev edits a paragraph in one field instead of six levels of nesting:

    prose-section      heading + markdown body
    checklist-section  heading + intro + list of strings
    faq-section        heading + intro + question/answer pairs
    video-section      heading + intro + embed html

Only wrappers holding a SINGLE heading/body group are converted (65% of them).
A wrapper with several groups is one grey card on the page -- the background
and the 30px rhythm come from the section element -- so splitting it into
siblings would paint a card per group and open white gaps between them. That
was caught by a screenshot diff against the pre-migration build, and those
wrappers are now left alone.

Anything not fully recognised is left on custom-section untouched, and reported.
Idempotent: already-migrated sections are skipped.

Usage:  python3 tools/wp-import/to_content_sections.py [--write]
        (dry run without --write, as with the other scripts here)
"""
import glob, os, sys, yaml, collections

WRITE = '--write' in sys.argv
ROOT = os.path.join(os.path.dirname(__file__), '../../src/content/pages')
CUSTOM = 'page-sections/builders/custom-section'
CE = 'building-blocks/core-elements/'
NEW = 'page-sections/content/'

# Heading size paired with each level in the source content. The components
# derive the same default (see sectionChrome.ts), so an explicit size is only
# kept when it differs.
DEFAULT_SIZE = {'h1': '2xl', 'h2': 'md', 'h3': 'md', 'h4': 'sm', 'h5': 'sm', 'h6': 'xs'}

# The only three spacing combinations the migrated pages use, keyed by
# (maxContentWidth, paddingHorizontal, paddingVertical).
PRESETS = {
    ('xl', 'lg', 'xl'): 'content',
    ('none', 'md', 'md'): 'panel',
    ('none', 'none', 'none'): 'bubble',
}

stats = collections.Counter()
unconverted = collections.Counter()


def kind(block):
    c = block.get('_component', '')
    return c[len(CE):] if c.startswith(CE) else None


def convert(sec):
    """custom-section -> list of new components, or None to leave it alone."""
    if sec.get('_component') != CUSTOM:
        return None
    # The spacing must be one of the three known presets, and the section must
    # not carry styling the new components cannot express (gradients,
    # background images, rounding, a custom theme).
    extra = set(sec) - {
        '_component', 'label', 'contentSections', 'class',
        'backgroundColor', 'colorScheme', 'maxContentWidth',
        'paddingHorizontal', 'paddingVertical',
    }
    if extra:
        unconverted[f'unsupported styling: {",".join(sorted(extra))}'] += 1
        return None
    if sec.get('colorScheme') not in (None, 'default', 'inherit'):
        unconverted['custom colorScheme'] += 1
        return None
    spacing = (
        sec.get('maxContentWidth'), sec.get('paddingHorizontal'), sec.get('paddingVertical'),
    )
    preset = PRESETS.get(spacing)
    if preset is None:
        unconverted[f'unknown spacing preset: {spacing}'] += 1
        return None
    blocks = sec.get('contentSections') or []
    if not blocks:
        unconverted['empty'] += 1
        return None
    kinds = [kind(b) for b in blocks]
    if any(k is None for k in kinds):
        unconverted['non-core-element child'] += 1
        return None
    # every child must be a shape we understand, with only the props we map
    for b, k in zip(blocks, kinds):
        allowed = {
            'heading': {'_component', 'text', 'level', 'size'},
            'text': {'_component', 'text'},
            'list': {'_component', 'items', 'listType'},
            'definition-list': {'_component', 'items'},
            'embed': {'_component', 'html', 'aspectRatio'},
            'divider': {'_component'},
        }.get(k)
        if allowed is None or set(b) - allowed:
            unconverted[f'{k}: unmapped props'] += 1
            return None
        if k == 'list':
            for it in b.get('items') or []:
                if set(it) - {'_component', 'text'}:
                    unconverted['list item: icon/colour set'] += 1
                    return None
        if k == 'definition-list':
            for it in b.get('items') or []:
                if set(it) - {'_component', 'title', 'text'}:
                    unconverted['dl item: unmapped props'] += 1
                    return None

    label = sec.get('label') or ''
    out = []
    i = 0
    # Group the flat child list into (heading, body...) runs. A heading opens a
    # new section; bodies attach to the open one.
    while i < len(blocks):
        b, k = blocks[i], kinds[i]
        head = None
        if k == 'heading':
            head = b
            i += 1
        bodies = []
        while i < len(blocks) and kinds[i] != 'heading':
            bodies.append((kinds[i], blocks[i]))
            i += 1
        if head is None and not bodies:
            break
        built = build(head, bodies)
        if built is None:
            return None
        out.append(built)
    if not out:
        return None
    # A wrapper holding several heading/body groups is ONE grey card on the
    # page: the background and the 30px rhythm come from the section element.
    # Splitting it into siblings would paint a separate card per group and open
    # white gaps between them (verified by screenshot), so those stay as they
    # are -- only single-group wrappers flatten.
    if len(out) > 1:
        unconverted[f'multi-group wrapper ({len(out)} groups)'] += 1
        return None
    # Carry the visual state onto every section the wrapper became, so a split
    # wrapper keeps its background rather than losing it on the 2nd group.
    bg = sec.get('backgroundColor', 'none')
    cls = sec.get('class')
    for s in out:
        if preset != 'content':
            s['preset'] = preset
        if bg and bg != 'none':
            s['backgroundColor'] = bg
        if cls:
            s['variant'] = cls
    # the wrapper's id came from its label; keep it on the first section only
    if label:
        out[0]['label'] = label
    return out


def build(head, bodies):
    """One (heading, body...) run -> one new component, or None if unmappable.

    Source order matters: a run of `text, list, text` renders the prose, then
    the list, then more prose. Collapsing all the prose into one field and
    appending the list would silently reorder the page, so a run whose prose is
    split around a structured block is rejected and left on custom-section.
    """
    sec = {}
    if head is not None:
        sec['heading'] = head.get('text', '')
        lvl = head.get('level', 'h2')
        sec['level'] = lvl
        size = head.get('size')
        if size and size != DEFAULT_SIZE.get(lvl):
            sec['size'] = size

    kinds = [k for k, _ in bodies]
    structured = [k for k in kinds if k != 'text' and k != 'divider']
    if len(structured) > 1:
        unconverted[f'mixed run: {"+".join(kinds)}'] += 1
        return None
    # Any prose after the structured block cannot be represented: the
    # components render heading, intro, then the block.
    if structured:
        at = kinds.index(structured[0])
        if 'text' in kinds[at + 1:]:
            unconverted[f'prose after {structured[0]}: {"+".join(kinds)}'] += 1
            return None

    prose = [b.get('text', '') for k, b in bodies if k == 'text']
    lists = [b for k, b in bodies if k == 'list']
    dls = [b for k, b in bodies if k == 'definition-list']
    embeds = [b for k, b in bodies if k == 'embed']

    if dls:
        sec['_component'] = NEW + 'faq-section'
        if prose:
            sec['intro'] = '\n\n'.join(prose)
        sec['questions'] = [
            {'question': it.get('title', ''), 'answer': it.get('text', '')}
            for it in dls[0].get('items') or []
        ]
        stats['faq-section'] += 1
    elif embeds:
        sec['_component'] = NEW + 'video-section'
        if prose:
            sec['intro'] = '\n\n'.join(prose)
        sec['html'] = embeds[0].get('html', '')
        ar = embeds[0].get('aspectRatio')
        if ar and ar != 'landscape':
            sec['aspectRatio'] = ar
        stats['video-section'] += 1
    elif lists:
        sec['_component'] = NEW + 'checklist-section'
        if prose:
            sec['intro'] = '\n\n'.join(prose)
        sec['items'] = [it.get('text', '') for it in lists[0].get('items') or []]
        lt = lists[0].get('listType', 'bullet')
        if lt != 'bullet':
            sec['listType'] = lt
        stats['checklist-section'] += 1
    else:
        sec['_component'] = NEW + 'prose-section'
        if prose:
            sec['body'] = '\n\n'.join(prose)
        stats['prose-section'] += 1
    # _component first, for readability in the content files
    return {'_component': sec.pop('_component'), **sec}


def walk(node):
    """Rewrite custom-sections in any nested array of components."""
    if isinstance(node, dict):
        for key, val in list(node.items()):
            if isinstance(val, list) and any(
                isinstance(x, dict) and '_component' in x for x in val
            ):
                new = []
                for item in val:
                    got = convert(item) if isinstance(item, dict) else None
                    if got:
                        new.extend(got)
                    else:
                        if isinstance(item, dict):
                            walk(item)
                        new.append(item)
                node[key] = new
            else:
                walk(val)
    elif isinstance(node, list):
        for x in node:
            walk(x)


def main():
    changed = 0
    for md in sorted(glob.glob(f'{ROOT}/**/*.md', recursive=True)):
        raw = open(md, encoding='utf8').read()
        parts = raw.split('---\n')
        if len(parts) < 3:
            continue
        d = yaml.safe_load(parts[1])
        if not d or CUSTOM not in parts[1]:
            continue
        before = yaml.safe_dump(d, sort_keys=False, allow_unicode=True, width=100)
        walk(d)
        after = yaml.safe_dump(d, sort_keys=False, allow_unicode=True, width=100)
        if before == after:
            continue
        changed += 1
        if WRITE:
            body = '---\n'.join(parts[2:])
            open(md, 'w', encoding='utf8').write('---\n' + after + '---\n' + body)
    print(f"{'rewrote' if WRITE else 'would rewrite'} {changed} pages")
    for k, v in stats.most_common():
        print(f"  {v:5d}  -> {k}")
    if unconverted:
        print("left on custom-section:")
        for k, v in unconverted.most_common():
            print(f"  {v:5d}  {k}")


main()
