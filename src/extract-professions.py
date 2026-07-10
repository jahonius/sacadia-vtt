"""
One-time transcription of the two professions absent from the Roll20 catalogs — the Fatebound and
the Hulinari Warrior — from the rulebook PDF into the same shape build-packs.mjs consumes.

PDF text extraction cannot recover the limb-cost icons (they're images), so `limb` is left null for
every entry — add limbs via the item sheet's picker. Attack category/save are prose-only here too
(like the other catalogs). Output is written to src/professions-extra.json for review + the build.
"""
import fitz, re, json, sys

doc = fitz.open('SacadiasArtOfWar_v1.0.pdf')
TAGMAP = {'A': 'action', 'P': 'passive', 'R': 'reaction', 'B': 'boost', 'F': 'focus', 'C': 'ceremony', 'L': 'lore'}

# CSP-tree ability entry: a [N] cost bracket, then the Title-Case name (same line or next), then a
# trailing superscript tag letter (or 2-3) and a colon. Level-progression milestones ("[Level N] …")
# don't match because the cost group is a bare integer. Free "starting" abilities (no [N]) are added
# from STARTERS below.
ENTRY = re.compile(r'\[(\d+)\]\s*\n?\s*([A-Z][A-Za-z’\' /-]{2,44}?)([PARBFCL]{1,3}):')

# The few no-cost starting abilities worth carrying (masteries live in their own pack already).
STARTERS = {
    'fatebound': [('Fated Strike', 'passive')],
    'hulinari_warrior': [('Shapeshift', 'action')],
}
NOISE = re.compile(r'(Professions\s*[–-].*|.*Aspect Tree|^\d+$|When You take this|When you take this Aspect)', re.M)

def clean(s):
    s = re.sub(r'\s+', ' ', s).strip()
    s = re.sub(r'\s*[–-]\s*$', '', s)
    return s

def extract(name, page_range):
    txt = ''.join(doc[i].get_text() for i in page_range)
    matches = list(ENTRY.finditer(txt))
    out = []
    seen = set()
    for i, m in enumerate(matches):
        tag = TAGMAP.get(m.group(3)[0])
        if not tag:
            continue
        aname = clean(m.group(2))
        if not aname or len(aname) < 3 or aname in seen:
            continue
        cost = int(m.group(1))
        # description = text between this match and the next entry
        end = matches[i + 1].start() if i + 1 < len(matches) else len(txt)
        body = txt[m.end():end]
        body = NOISE.sub(' ', body)
        body = clean(body)
        prereq = ''
        pm = re.match(r'\(Prerequisite:\s*([^)]*)\)\.?\s*', body)
        if pm:
            prereq = clean(pm.group(1))
            body = body[pm.end():]
        body = clean(body)
        if len(body) < 8:  # too short → likely a mis-split header, skip
            continue
        seen.add(aname)
        out.append({
            'name': aname,
            'tag': tag,
            'cspCost': cost,
            'prerequisite': prereq,
            'description': body,
        })
    # Prepend the free starting abilities, pulling their description from the same text.
    for sname, stag in STARTERS.get(name.lower().replace(' warrior', '_warrior'), []):
        sm = re.search(re.escape(sname) + r'[PARBFCL]{0,2}:\s*(.{20,500}?)(?:\n[A-Z][a-z]+ ?[A-Z]|\[\d)', txt, re.S)
        if sm and not any(o['name'] == sname for o in out):
            out.insert(0, {'name': sname, 'tag': stag, 'cspCost': 0, 'prerequisite': '', 'description': clean(sm.group(1))})
    return out

data = {
    'fatebound': extract('Fatebound', range(104, 110)),
    'hulinari_warrior': extract('Hulinari', range(110, 118)),
}
for k, v in data.items():
    print(f'{k}: {len(v)} abilities', file=sys.stderr)
with open('src/professions-extra.json', 'w') as f:
    json.dump(data, f, indent=1, ensure_ascii=False)
