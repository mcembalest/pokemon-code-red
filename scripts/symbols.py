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
    # battle (agent prototype): RAM
    'gMain': 0x438,
    'gBattleTypeFlags': 4,
    'gBattleMons': 4 * 0x58,
    'gBattlerControllerFuncs': 16,
    'gActionSelectionCursor': 4,
    'gMoveSelectionCursor': 4,
    'gBattleOutcome': 1,
    'gCodeRedMove': 48,
    'gTasks': 16 * 40,
    'gPokemonStoragePtr': 4,  # PC boxes (PokÉEG: every owned Pokémon)
    # code / ROM data (bytes = 0: not RAM)
    'BattleMainCB2': 0,
    'gBattleMoves': 0,
    'gMoveNames': 0,
    'gSpeciesNames': 0,
    'gTypeNames': 0,
    'gSpeciesInfo': 0,       # types, growth rate
    'gExperienceTables': 0,  # level from experience (box Pokémon store no level)
}

# Static functions share names across files: (object, name) -> exported key "object.name".
WANTED_LOCAL = [
    ('battle_controller_player', 'HandleInputChooseAction'),
    ('battle_controller_player', 'HandleInputChooseMove'),
    ('battle_controller_oak_old_man', 'HandleInputChooseAction'),
    ('battle_controller_oak_old_man', 'OakOldManHandleInputChooseMove'),
    ('script_menu', 'Task_ScriptShowMonPic'),
]
DECOMP = ROOT / '.cache/pokefirered'


def parse_local(text):
    import subprocess
    found = {}
    for obj, name in WANTED_LOCAL:
        m = re.search(r'^ \.text\s+(0x[0-9a-f]+)\s+(0x[0-9a-f]+)\s+src/' + re.escape(obj) + r'\.o$', text, re.M)
        if not m:
            continue
        out = subprocess.check_output(['arm-none-eabi-nm', str(DECOMP / f'build/firered/src/{obj}.o')], text=True)
        for line in out.splitlines():
            parts = line.split()
            if len(parts) == 3 and parts[2] == name and parts[1] in 'tT':
                found[f'{obj}.{name}'] = {'address': int(m.group(1), 16) + int(parts[0], 16), 'bytes': 0}
    return found

def parse(text):
    found = {}
    for name in WANTED:
        m = re.search(r'^\s+(0x[0-9a-f]+)\s+' + re.escape(name) + r'(?:\s*= \.)?\s*$', text, re.M)
        if m:
            found[name] = {'address': int(m.group(1), 16), 'bytes': WANTED[name]}
    return found

def main():
    text = MAP.read_text()
    symbols = {**parse(text), **parse_local(text)}
    missing = sorted((set(WANTED) | {f'{o}.{n}' for o, n in WANTED_LOCAL}) - set(symbols))
    if missing:
        sys.exit(f'missing symbols in {MAP}: {missing}')
    manifest = json.loads((ROOT / 'build/manifest.json').read_text())
    OUT.write_text(json.dumps({'rom_sha1': manifest['sha1'], 'symbols': symbols}, indent=2) + '\n')
    print(f'wrote {OUT.relative_to(ROOT)}')

if __name__ == '__main__':
    main()
