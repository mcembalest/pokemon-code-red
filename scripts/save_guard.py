#!/usr/bin/env python3
"""Fail if a change could break players' existing saves.

Players keep their in-game save across Code Red updates (player/src/saves.ts).
That only works while the saved structs keep their layout. Checks:
  1. sizes of the saved blocks in the built ELF == save.lock.json
  2. no patch touches the save-struct sources unless its header says
     `Save-Migration: <what migrates and how>`
Usage: python3 scripts/save_guard.py [--update]   (--update rewrites save.lock.json)
"""
import json, re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ELF = ROOT / '.cache/pokefirered/pokefirered.elf'
LOCK = ROOT / 'save.lock.json'
SAVED = ['gSaveBlock1', 'gSaveBlock2', 'gPokemonStorage']
PROTECTED = re.compile(r'^(include/(global|pokemon|save|load_save)\.h|include/global\.\w+\.h|src/(save|load_save)\.c)$')


def sizes() -> dict:
    out = subprocess.check_output(['arm-none-eabi-nm', '-S', str(ELF)], text=True)
    found = {}
    for line in out.splitlines():
        p = line.split()
        if len(p) == 4 and p[3] in SAVED:
            found[p[3]] = int(p[1], 16)
    missing = set(SAVED) - set(found)
    if missing:
        sys.exit(f'save_guard: {sorted(missing)} not in {ELF}')
    return found


def protected_touches(patches: Path = ROOT / "patches") -> list[str]:
    bad = []
    for patch in sorted(patches.glob("*.patch")):
        text = patch.read_text(errors='replace')
        header = text.split('\ndiff --git', 1)[0]
        touched = [m for m in re.findall(r'^\+\+\+ b/(\S+)', text, re.M) if PROTECTED.match(m)]
        if touched and 'Save-Migration:' not in header:
            bad.append(f'{patch.name}: {", ".join(touched)}')
    return bad


def main():
    now = sizes()
    if '--update' in sys.argv:
        LOCK.write_text(json.dumps({'note': 'sizes of saved structs; see scripts/save_guard.py', 'sizes': now}, indent=2) + '\n')
        print(f'wrote {LOCK.name}: {now}')
        return
    locked = json.loads(LOCK.read_text())['sizes']
    problems = [f'{k}: {locked.get(k)} -> {v} bytes' for k, v in now.items() if locked.get(k) != v]
    problems += [f'patch touches save structs without Save-Migration: {b}' for b in protected_touches()]
    if problems:
        print('save_guard: this change could break existing player saves', file=sys.stderr)
        for p in problems:
            print('  - ' + p, file=sys.stderr)
        print('Add a migration (player/src/saves.ts) and a Save-Migration: header, then run with --update.', file=sys.stderr)
        sys.exit(1)
    print(f'save_guard ok: {now}')


if __name__ == '__main__':
    main()
