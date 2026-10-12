#!/usr/bin/env python3
"""Code-speak (playtest 1, 2026-10-12): the ROM's move descriptions, item descriptions and Pokédex entries, mildly
projected — FireRed's sentences with a word or two turned toward code. The texts live in one editable table,
rules/text.mjs (MOVE_TEXT by Code Red move name, ITEM_TEXT by ITEM_ constant, DEX_TEXT by species); this script
writes them into the decomp and regenerates patches/010-codespeak.patch.

  python3 scripts/codespeak.py              # table → decomp → patch 010 (`make text`)
  python3 scripts/codespeak.py --check      # CI: the ROM's texts (as the patches build them) match the table
  python3 scripts/codespeak.py --originals  # the FireRed originals for everything a player meets to Erika (to author from)

Widths are FireRed's own (characters, a proxy for its proportional font): moves 4 lines × 21, items 3 × 36,
Pokédex 3 × 43; the table holds flat text and this script wraps it (a newline forces a break). Texts the table
does not name keep their FireRed words.
"""
import json, re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DECOMP = ROOT / '.cache/pokefirered'
PATCH = ROOT / 'patches/010-codespeak.patch'
FILES = {'moves': 'src/move_descriptions.c', 'items': 'src/data/items.json', 'dex': 'src/data/pokemon/pokedex_text_fr.h'}  # items.h is generated from the json
LIMITS = {'moves': (4, 21), 'items': (3, 36), 'dex': (3, 43)}

MOVE_RE = r'(gMoveDescription_(\w+)\[\] = _\(")((?:[^"\\]|\\.)*)("\))'
ITEM_RE = r'("itemId": "(\w+)",\n(?:.*\n)*?\s*"description_english": ")((?:[^"\\]|\\.)*)(")'  # items.json: the description follows the id
DEX_RE = r'(g(\w+)PokedexText\[\] = _\()(\s*(?:"[^"]*"\s*)+)(\))'


def symbol(firered: str) -> str:
    """FireRed move name → the decomp's CamelCase symbol (Water Gun → WaterGun, Sand-Attack → SandAttack, Vice Grip → ViceGrip)."""
    return ''.join(w[:1].upper() + w[1:] for w in re.split(r'[\s\-]+', firered))


def table() -> dict:
    out = subprocess.run(['node', '-e', "import('./rules/text.mjs').then(t => console.log(JSON.stringify({moves: t.MOVE_TEXT, items: t.ITEM_TEXT, dex: t.DEX_TEXT})))"],
                         cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def moves_by_name() -> dict[str, str]:
    """Code Red name → decomp symbol."""
    out = subprocess.run(['node', '-e', "import('./rules/index.mjs').then(r => console.log(JSON.stringify(r.MOVES.map(m => [m.name, m.firered]))))"],
                         cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return {n: symbol(f) for n, f in json.loads(out)}


def wrap(kind: str, key: str, text: str) -> str:
    """Greedy word wrap to the kind's width and line count (a newline in the table forces a break)."""
    lines, width = LIMITS[kind]
    assert '"' not in text and '\\' not in text, f'{kind} {key}: no quotes or backslashes'
    out = []
    for para in text.split('\n'):
        line = ''
        for w in para.split():
            assert len(w) <= width, f'{kind} {key}: "{w}" is wider than {width}'
            if line and len(line) + 1 + len(w) > width: out.append(line); line = w
            else: line = f'{line} {w}' if line else w
        if line: out.append(line)
    assert len(out) <= lines, f'{kind} {key}: {len(out)} lines (max {lines}): {out}'
    return '\n'.join(out)


def encode_dex(text: str) -> str:
    ls = text.split('\n')
    return '\n' + '\n'.join(f'    "{l}{"" if i == len(ls) - 1 else chr(92) + "n"}"' for i, l in enumerate(ls))


def apply(kind: str, src: str, texts: dict[str, str]) -> tuple[str, set[str]]:
    seen = set()
    if kind == 'dex':
        def sub(m):
            k = m.group(2).upper()
            if k not in texts: return m.group(0)
            seen.add(k); return m.group(1) + encode_dex(texts[k]) + m.group(4)
        return re.sub(DEX_RE, sub, src), seen
    rx = MOVE_RE if kind == 'moves' else ITEM_RE
    def sub(m):
        k = m.group(2)
        if k not in texts: return m.group(0)
        seen.add(k); return m.group(1) + texts[k].replace('\n', '\\\\n' if kind == 'items' else '\\n') + m.group(4)  # the json holds a literal backslash-n
    return re.sub(rx, sub, src), seen


def originals() -> None:
    inv = (ROOT / 'notes/inventory-to-erika.md').read_text()
    moves = re.findall(r'^\| ([^|]+?) \| ([A-Z0-9 ]+) \|', inv.split('## Moves')[1].split('## Species')[0], re.M)[1:]  # [0] is the header row
    species = [s.upper().replace(' ', '').replace('.', '').replace("'", '').replace('_', '') for s in re.findall(r'^\| ([A-Z][^|]+?) \| [A-Z]', inv.split('## Species')[1].split('## Trainers')[0], re.M) if s != 'Pokémon']
    sys.path.insert(0, str(ROOT / 'scripts'))
    from inventory import MAPS  # noqa: E402
    towns = {m.split('_')[0] for m in MAPS['erika']}
    items = set()
    for p in (DECOMP / 'data/maps').iterdir():
        if p.name.split('_')[0] in towns and (p / 'scripts.inc').exists():
            items |= set(re.findall(r'\bITEM_([A-Z0-9_]+)', (p / 'scripts.inc').read_text()))
    items -= {'NONE'}
    items = {i for i in items if not re.fullmatch(r'(TM|HM)\d\d', i)}
    mv = {m[1]: m[2] for m in re.findall(MOVE_RE, (DECOMP / FILES['moves']).read_text())}
    it = {m[1]: m[2] for m in re.findall(ITEM_RE, (DECOMP / FILES['items']).read_text())}
    dx = {m[1].upper(): ''.join(re.findall(r'"([^"]*)"', m[2])).replace('\\n', '\n') for m in re.findall(DEX_RE, (DECOMP / FILES['dex']).read_text())}
    print(f'// moves ({len(moves)})')
    for firered, cr in moves:
        key = cr if re.fullmatch(r'[A-Z0-9]+', cr) else repr(cr)
        print(f'  {key}: {json.dumps(mv.get(symbol(firered), "?").replace(chr(92) + "n", chr(10)))},  // {firered}')
    print(f'// items ({len(items)})')
    for i in sorted(items):
        if f'ITEM_{i}' in it: print(f'  ITEM_{i}: {json.dumps(it["ITEM_" + i].replace(chr(92) * 2 + "n", chr(10)).replace(chr(92) + "n", chr(10)))},')
    print(f'// dex ({len(species)})')
    for s in species:
        print(f'  {s}: {json.dumps(dx.get(s, "?"))},')


def main() -> int:
    if '--originals' in sys.argv:
        originals(); return 0
    t = table()
    names = moves_by_name()
    for kind in FILES:
        t[kind] = {k: wrap(kind, k, v) for k, v in t[kind].items()}
    unknown = [k for k in t['moves'] if k not in names]
    assert not unknown, f'not Code Red moves: {unknown}'
    move_texts = {names[k]: v for k, v in t['moves'].items()}
    before = {k: (DECOMP / f).read_text() for k, f in FILES.items()}
    subprocess.run(['git', 'checkout', '--', *FILES.values()], cwd=DECOMP, check=True)
    after = {}
    for kind, f in FILES.items():
        src = (DECOMP / f).read_text()
        texts = move_texts if kind == 'moves' else t[kind]
        after[kind], seen = apply(kind, src, texts)
        missing = set(texts) - seen
        assert not missing, f'{kind}: not in {f}: {sorted(missing)}'
    if '--check' in sys.argv:
        for kind, f in FILES.items(): (DECOMP / f).write_text(before[kind])
        stale = [FILES[k] for k in FILES if before[k] != after[k]]
        if stale:
            print(f'code-speak texts in the ROM differ from rules/text.mjs ({", ".join(stale)}): run `make text`'); return 1
        print(f'{sum(len(t[k]) for k in FILES)} texts match'); return 0
    for kind, f in FILES.items(): (DECOMP / f).write_text(after[kind])
    header = PATCH.read_text().split('diff --git')[0] if PATCH.exists() else (
        'Code-speak: move descriptions, item descriptions and Pokédex entries, mildly projected (playtest 1, 2026-10-12).\n'
        'Generated from rules/text.mjs by scripts/codespeak.py (`make text`); edit the table, not this patch.\n\n')
    diff = subprocess.check_output(['git', 'diff', '--abbrev=7', '--', *FILES.values()], cwd=DECOMP, text=True)
    PATCH.write_text(header + diff)
    print(f'{len(t["moves"])} moves, {len(t["items"])} items, {len(t["dex"])} dex entries → {PATCH.name}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
