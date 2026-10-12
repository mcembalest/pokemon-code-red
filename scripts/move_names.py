#!/usr/bin/env python3
"""Regenerate patches/007-move-names.patch from rules/moves.mjs: every Code Red move's name goes into the ROM's
gMoveNames (src/data/text/move_names.h, 12 characters at most) and what its code must return into the summary
screen's move descriptions (src/move_descriptions.c, four lines of about 20 characters: the spec, or BRIEF when the
spec is too long, in the GBA font's characters). Run after adding or renaming moves (`make names`), then rebuild.
`--check`: CI, exit 1 if the ROM tables are stale."""
import json, re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DECOMP = ROOT / '.cache/pokefirered'
PATCH = ROOT / 'patches/007-move-names.patch'
FILES = ['src/data/text/move_names.h', 'src/move_descriptions.c']

moves, brief = json.loads(subprocess.check_output(['node', '-e', "import('./rules/index.mjs').then(m => console.log(JSON.stringify([m.MOVES.map(x => [x.firered, x.name, x.spec]), m.BRIEF])))"], cwd=ROOT))
const = lambda firered: 'MOVE_' + re.sub(r'[^A-Z0-9]+', '_', firered.upper()).strip('_')
names = {const(f): n for f, n, _ in moves}
for n in names.values():
    assert len(n) <= 12, f'{n}: longer than 12 characters'


def description(name: str, spec: str) -> str:
    """'Returns the first 3 numbers.' wrapped to four lines of at most 20 characters, in the GBA font's characters."""
    text = 'Returns ' + brief.get(name, spec) + '.'
    for a, b in (('…', '...'), ('→', ' to '), ('−', '-'), ('[', '('), (']', ')'), ('÷', '/')):
        text = text.replace(a, b)
    text = re.sub(r'  +', ' ', text)
    assert not re.search(r"[^A-Za-z0-9 ,.:;'()%+/!?-]", text), f'{name}: a character the GBA font lacks in {text!r}'
    lines, line = [], ''
    for word in text.split(' '):
        if len((line + ' ' + word).strip()) > 20:
            lines.append(line.strip()); line = word
        else:
            line = line + ' ' + word
    lines.append(line.strip())
    assert len(lines) <= 4, f'{name}: {len(lines)} lines; shorten its BRIEF in rules/moves.mjs: {lines}'
    return '\\n'.join(lines)


descs = {const(f): description(n, spec) for f, n, spec in moves}
before = {f: (DECOMP / f).read_text() for f in FILES}
subprocess.run(['git', 'checkout', '--', *FILES], cwd=DECOMP, check=True)
text = (DECOMP / FILES[0]).read_text()
missing = [k for k in names if f'[{k}]' not in text]
assert not missing, f'not in move_names.h: {missing}'
def sub(m):
    k = m.group(1)
    return f'[{k}]{m.group(2)}= _("{names[k]}")' if k in names else m.group(0)
text = re.sub(r'\[(MOVE_\w+)\](\s*)= _\("[^"]*"\)', sub, text)
dtext = (DECOMP / FILES[1]).read_text()
# gMoveDescription_<CamelName>[] = _("…") holds the text; the pointer table maps [MOVE_X - 1] = gMoveDescription_<CamelName>
table = dict(re.findall(r'\[(MOVE_\w+)\s*-\s*1\]\s*=\s*(gMoveDescription_\w+)', dtext))
missing = [k for k in descs if k not in table]
assert not missing, f'not in move_descriptions.c: {missing}'
for k, d in descs.items():
    dtext, n = re.subn(r'(const u8 ' + table[k] + r'\[\] = _\(")[^"]*("\);)', lambda m: m.group(1) + d + m.group(2), dtext)
    assert n == 1, f'{table[k]}: {n} definitions'
if '--check' in sys.argv:  # CI: the ROM's tables (as the patches build them) must already say what the rules say
    for f in FILES:
        (DECOMP / f).write_text(before[f])
    if before[FILES[0]] != text or before[FILES[1]] != dtext:
        print('move names or descriptions in the ROM differ from rules/moves.mjs: run `make names`'); raise SystemExit(1)
    print(f'{len(names)} move names and descriptions match'); raise SystemExit(0)
(DECOMP / FILES[0]).write_text(text)
(DECOMP / FILES[1]).write_text(dtext)
header = PATCH.read_text().split('diff --git')[0]
diff = subprocess.check_output(['git', 'diff', '--abbrev=7', '--', *FILES], cwd=DECOMP, text=True)
PATCH.write_text(header + diff)
print(f'{len(names)} names and descriptions → {PATCH.name}')
