#!/usr/bin/env python3
"""Regenerate patches/007-move-names.patch from rules/moves.mjs: every Code Red move's name goes into the ROM's
gMoveNames (src/data/text/move_names.h, 12 characters at most). Run after adding or renaming moves (`make names`), then rebuild. `--check`: CI, exit 1 if the ROM table is stale."""
import json, re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DECOMP = ROOT / '.cache/pokefirered'
PATCH = ROOT / 'patches/007-move-names.patch'

moves = json.loads(subprocess.check_output(['node', '-e', "import('./rules/index.mjs').then(m => console.log(JSON.stringify(m.MOVES.map(x => [x.firered, x.name]))))"], cwd=ROOT))
const = lambda firered: 'MOVE_' + re.sub(r'[^A-Z0-9]+', '_', firered.upper()).strip('_')
names = {const(f): n for f, n in moves}
for n in names.values():
    assert len(n) <= 12, f'{n}: longer than 12 characters'

path = DECOMP / 'src/data/text/move_names.h'
before = path.read_text()
subprocess.run(['git', 'checkout', '--', 'src/data/text/move_names.h'], cwd=DECOMP, check=True)
text = path.read_text()
missing = [k for k in names if f'[{k}]' not in text]
assert not missing, f'not in move_names.h: {missing}'
def sub(m):
    k = m.group(1)
    return f'[{k}]{m.group(2)}= _("{names[k]}")' if k in names else m.group(0)
text = re.sub(r'\[(MOVE_\w+)\](\s*)= _\("[^"]*"\)', sub, text)
if '--check' in sys.argv:  # CI: the ROM's table (as the patches build it) must already say what the rules say
    path.write_text(before)
    if before != text:
        print('move names in the ROM differ from rules/moves.mjs: run `make names`'); raise SystemExit(1)
    print(f'{len(names)} move names match'); raise SystemExit(0)
path.write_text(text)
header = PATCH.read_text().split('diff --git')[0]
diff = subprocess.check_output(['git', 'diff', '--abbrev=7', '--', 'src/data/text/move_names.h'], cwd=DECOMP, text=True)
PATCH.write_text(header + diff)
print(f'{len(names)} names → {PATCH.name}')
