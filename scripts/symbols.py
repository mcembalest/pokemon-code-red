#!/usr/bin/env python3
"""Emit build/symbols.json: RAM addresses the player needs, from the linker map.

Shipped next to each ROM build so the browser finds mailboxes without any
address compiled into the emulator core.
"""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAP = ROOT / '.cache/pokefirered/pokefirered.map'
OUT = ROOT / 'build/symbols.json'
WANTED = {
    'gCodeRedMailbox': 36,
    'gCodeRedNamingMailbox': 60,
    'gSaveBlock1Ptr': 4,
    'gSaveBlock2Ptr': 4,
    'gPlayerPartyCount': 1,
    'gPlayerParty': 600,
}

def parse(text):
    found = {}
    for name in WANTED:
        m = re.search(r'^\s+(0x[0-9a-f]+)\s+' + re.escape(name) + r'(?:\s*= \.)?\s*$', text, re.M)
        if m:
            found[name] = {'address': int(m.group(1), 16), 'bytes': WANTED[name]}
    return found

def main():
    symbols = parse(MAP.read_text())
    missing = sorted(set(WANTED) - set(symbols))
    if missing:
        sys.exit(f'missing symbols in {MAP}: {missing}')
    manifest = json.loads((ROOT / 'build/manifest.json').read_text())
    OUT.write_text(json.dumps({'rom_sha1': manifest['sha1'], 'symbols': symbols}, indent=2) + '\n')
    print(f'wrote {OUT.relative_to(ROOT)}')

if __name__ == '__main__':
    main()
