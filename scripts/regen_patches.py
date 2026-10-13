#!/usr/bin/env python3
"""Regenerate patches/NNN-*.patch from the edited sources in .cache/pokefirered (which git ignores).

The dev loop for game-side changes: `make build` applies the patches into .cache/pokefirered → edit the C / .inc
files there → `make patches` writes them back as patches → `make build` again (the ROM) → commit the patches.
Each patch keeps its header (the text above the first `diff --git`) and owns the files listed below; a file edited
in the decomp that no patch owns is reported, not lost.

  python3 scripts/regen_patches.py            all patches
  python3 scripts/regen_patches.py 006 008    just these
  python3 scripts/regen_patches.py --check    exit 1 if any patch would change (CI)
"""
import subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DECOMP = ROOT / '.cache/pokefirered'
PATCHES = ROOT / 'patches'

# patch number -> (tracked files it changes, new files it adds). Everything else is left alone.
OWNS = {
    '001': (['data/text/new_game_intro.inc'], []),
    '002': (['data/specials.inc'], ['src/code_red.c']),
    '003': (['data/maps/PalletTown_PlayersHouse_2F/scripts.inc', 'data/scripts/pc.inc', 'src/player_pc.c', 'src/script_menu.c'], []),
    '005': (['src/naming_screen.c'], []),
    '006': (['data/battle_scripts_1.s', 'include/battle_scripts.h', 'include/constants/battle_string_ids.h', 'src/battle_message.c',
             'src/battle_script_commands.c', 'src/battle_util.c'], ['src/code_red_battle.c']),
    '007': (['src/data/text/move_names.h'], []),   # generated from rules/moves.mjs: scripts/move_names.py
    '008': ([], ['src/code_red_eeg.c']),
    '009': (['src/battle_util2.c', 'src/battle_anim.c', 'src/sound.c'], ['src/code_red_payload.c']),
    '010': (['src/move_descriptions.c', 'src/data/items.json', 'src/data/pokemon/pokedex_text_fr.h'], []),   # generated from rules/text.mjs: scripts/codespeak.py
}


def git(*args: str) -> str:
    # --abbrev: index lines carry 7-character blob ids whatever git's default (so a regenerated patch is byte-stable)
    return subprocess.run(['git', *args[:1], '--abbrev=7', *args[1:]] if args[0] == 'diff' else ['git', *args],
                          cwd=DECOMP, capture_output=True, text=True, check=False).stdout


def regenerate(num: str) -> tuple[Path, str]:
    path = next(PATCHES.glob(f'{num}-*.patch'))
    header = path.read_text().split('diff --git')[0]
    tracked, added = OWNS[num]
    out = header + (git('diff', '--', *tracked) if tracked else '')
    for f in added:
        out += git('diff', '--no-index', '/dev/null', f)
    return path, out


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    check = '--check' in sys.argv
    nums = args or sorted(OWNS)
    changed = []
    for num in nums:
        path, text = regenerate(num)
        if path.read_text() != text:
            changed.append(path.name)
            if not check:
                path.write_text(text)
                ok = subprocess.run(['git', 'apply', '--reverse', '--check', str(path)], cwd=DECOMP, capture_output=True).returncode == 0
                print(f'{path.name}: regenerated{"" if ok else " (WARNING: does not reverse-apply cleanly)"}')
    owned = {f for t, a in OWNS.values() for f in t + a}
    stray = [f for f in git('status', '--porcelain').splitlines() if f[3:] not in owned and not f[3:].endswith('/')]
    if stray:
        print('edited in the decomp but owned by no patch (add it to OWNS or revert):', *stray, sep='\n  ')
    if check:
        if changed:
            print('patches out of date:', ', '.join(changed), '\nrun: make patches')
            sys.exit(1)
        print('patches match the sources')
    elif not changed:
        print('nothing changed')


if __name__ == '__main__':
    main()
