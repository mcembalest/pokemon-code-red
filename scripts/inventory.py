#!/usr/bin/env python3
"""What a player can meet up to a point in the game, from the decomp's own data: species (wild, gifts, starters and
their evolutions), the moves they can know (level-up, the TMs/HMs found or sold on the way, trainers' movesets),
and which of those moves have no Code Red code yet (rules/moves.mjs). The seasoned-player check: any move a
player can see must be a Code Red move, or the game looks half-done.

  python3 scripts/inventory.py              # to Erika (the release line): notes/inventory-to-erika.md + a summary
  python3 scripts/inventory.py --to misty
  python3 scripts/inventory.py --missing    # only the moves without code, one per line (CI: exit 1 if any)
"""
import argparse, json, re, subprocess, sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
D = ROOT / '.cache/pokefirered'
src = lambda p: (D / p).read_text()

# The maps a player walks before each line (map names as in data/maps). Trainers come from these maps' object events.
MAPS = {
    'misty': ['PalletTown', 'Route1', 'ViridianCity', 'Route22', 'Route2', 'ViridianForest', 'PewterCity', 'PewterCity_Gym', 'Route3',
              'MtMoon_1F', 'MtMoon_B1F', 'MtMoon_B2F', 'Route4', 'CeruleanCity', 'CeruleanCity_Gym', 'Route24', 'Route25'],
}
MAPS['surge'] = MAPS['misty'] + ['Route5', 'Route6', 'UndergroundPath_NorthSouthTunnel', 'VermilionCity', 'VermilionCity_Gym', 'SSAnne_1F', 'SSAnne_2F',
                                 'SSAnne_B1F', 'SSAnne_Deck', 'SSAnne_1F_Room1', 'SSAnne_1F_Room2', 'SSAnne_1F_Room3', 'SSAnne_1F_Room4', 'SSAnne_1F_Room5',
                                 'SSAnne_1F_Room7', 'SSAnne_2F_Room1', 'SSAnne_2F_Room2', 'SSAnne_2F_Room3', 'SSAnne_2F_Room4', 'SSAnne_2F_Room5',
                                 'SSAnne_2F_Room6', 'SSAnne_B1F_Room1', 'SSAnne_B1F_Room2', 'SSAnne_B1F_Room3', 'SSAnne_B1F_Room4', 'SSAnne_B1F_Room5',
                                 'SSAnne_Kitchen', 'SSAnne_CaptainsOffice', 'SSAnne_Exterior', 'Route11', 'DiglettsCave_B1F']
MAPS['erika'] = MAPS['surge'] + ['Route9', 'Route10', 'RockTunnel_1F', 'RockTunnel_B1F', 'PowerPlant', 'LavenderTown', 'Route8', 'Route7',
                                 'UndergroundPath_EastWestTunnel', 'CeladonCity', 'CeladonCity_Gym', 'CeladonCity_DepartmentStore_2F',
                                 'CeladonCity_DepartmentStore_4F', 'CeladonCity_DepartmentStore_5F', 'CeladonCity_GameCorner',
                                 'CeladonCity_GameCorner_PrizeRoom', 'CeladonCity_Condominiums_1F', 'CeladonCity_Condominiums_RoofRoom', 'Route12', 'Route13']
LEVEL_CAP = {'misty': 25, 'surge': 35, 'erika': 45}   # level-up moves a player's Pokémon can have learned by then
GIFTS = {'misty': ['BULBASAUR', 'CHARMANDER', 'SQUIRTLE', 'MAGIKARP'], 'surge': ['BULBASAUR', 'CHARMANDER', 'SQUIRTLE', 'MAGIKARP'],
         'erika': ['BULBASAUR', 'CHARMANDER', 'SQUIRTLE', 'MAGIKARP', 'EEVEE']}  # the Mt. Moon Magikarp, the Celadon Eevee


def trainer_ids_on(maps: list[str]) -> set[str]:
    out = set()
    for m in maps:
        p = D / 'data/maps' / m / 'scripts.inc'
        if p.exists():
            out |= set(re.findall(r'trainerbattle\w*\s+(TRAINER_\w+)', p.read_text()))
    return out


def trainer(tid: str, trainers_h: str, parties_h: str) -> dict | None:
    m = re.search(r'\[' + tid + r'\] = \{(.*?)\n    \},', trainers_h, re.S)
    if not m:
        return None
    body = m.group(1)
    name = re.search(r'trainerName = _\("([^"]*)"\)', body).group(1)
    cls = re.search(r'trainerClass = TRAINER_CLASS_(\w+)', body).group(1)
    party = re.search(r'party = \w+\((sParty_\w+)\)', body).group(1)
    pm = re.search(party + r'\[\] = \{(.*?)\n\};', parties_h, re.S)
    mons = []
    for blk in re.findall(r'\{(.*?)\}\s*,?\s*(?=\{|$)', pm.group(1), re.S):
        sp, lv, mv = re.search(r'species = SPECIES_(\w+)', blk), re.search(r'lvl = (\d+)', blk), re.search(r'moves = \{([^}]*)', blk)
        if sp:
            mons.append({'species': sp.group(1), 'level': int(lv.group(1)), 'moves': [x.strip().replace('MOVE_', '') for x in mv.group(1).split(',')] if mv else None})
    return {'id': tid, 'class': cls, 'name': name, 'party': mons}


def learnsets() -> dict[str, list[tuple[int, str]]]:
    ls, ptr = src('src/data/pokemon/level_up_learnsets.h'), src('src/data/pokemon/level_up_learnset_pointers.h')
    arrays = {a: [(int(l), mv) for l, mv in re.findall(r'LEVEL_UP_MOVE\(\s*(\d+)\s*,\s*MOVE_(\w+)\)', b)]
              for a, b in re.findall(r'(s\w+LevelUpLearnset)\[\] = \{(.*?)\};', ls, re.S)}
    return {sp: arrays[a] for sp, a in re.findall(r'\[SPECIES_(\w+)\] = (s\w+LevelUpLearnset)', ptr)}


def moves_at(ls: list[tuple[int, str]], lvl: int) -> list[str]:
    out: list[str] = []
    for l, m in ls:
        if l <= lvl:
            if m in out:
                out.remove(m)
            out.append(m)
    return out[-4:]


def tmhm() -> tuple[dict[str, str], dict[str, set[str]]]:
    """TM/HM number -> move; species -> the TM/HM moves it can learn (tmhm_learnsets.h spells both: TMHM(TM06_TOXIC))."""
    tm_moves: dict[str, str] = {}
    learn: dict[str, set[str]] = {}
    for sp, body in re.findall(r'\[SPECIES_(\w+)\]\s*=\s*TMHM_LEARNSET\((.*?)\)\s*,', src('src/data/pokemon/tmhm_learnsets.h'), re.S):
        pairs = re.findall(r'TMHM\(((?:TM|HM)\d\d)_(\w+)\)', body)
        tm_moves.update(pairs)
        learn[sp] = {mv for _, mv in pairs}
    return tm_moves, learn


def tmhm_on(maps: list[str]) -> set[str]:
    """TMs/HMs given, found or sold on these maps (scripts: giveitem/finditem/pokemart lists; Game Corner prizes)."""
    out = set()
    for m in maps:
        p = D / 'data/maps' / m / 'scripts.inc'
        if p.exists():
            out |= set(re.findall(r'ITEM_(TM\d\d|HM\d\d)', p.read_text()))
    return out


def species_info(sp: str, si: str) -> dict:
    b = re.search(r'\[SPECIES_' + sp + r'\] =\s*\{(.*?)\n    \},', si, re.S).group(1)
    t = re.search(r'\.types = \{\s*TYPE_(\w+),\s*TYPE_(\w+)\}', b)
    return {'types': sorted(set(t.groups()), key=t.groups().index)}


def evolutions(sp: str, evo: str) -> list[tuple[str, str, str]]:
    m = re.search(r'\[SPECIES_' + sp + r'\]\s*=\s*\{(.*?)\}\s*,\s*\n', evo, re.S)
    return re.findall(r'\{EVO_(\w+),\s*(\w+),\s*SPECIES_(\w+)\}', m.group(1)) if m else []


def code_red_moves() -> dict[str, str]:
    """FireRed move name (MOVE_ style) -> Code Red name, from rules/moves.mjs."""
    out = subprocess.run(['node', '-e', "import('./rules/index.mjs').then(r => console.log(JSON.stringify(Object.values(r.MOVES ?? r.byName).map(m => [m.firered, m.name]))))"],
                         cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return {fr.upper().replace(' ', '_').replace('-', '_'): cr for fr, cr in json.loads(out)}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--to', default='erika', choices=list(MAPS))
    ap.add_argument('--missing', action='store_true', help='only the moves without code (exit 1 if any)')
    args = ap.parse_args()
    maps = MAPS[args.to]
    cap = LEVEL_CAP[args.to]
    trainers_h, parties_h = src('src/data/trainers.h'), src('src/data/trainer_parties.h')
    si, evo = src('src/data/pokemon/species_info.h'), src('src/data/pokemon/evolution.h')
    ls = learnsets()
    wild = json.load(open(D / 'src/data/wild_encounters.json'))['wild_encounter_groups'][0]['encounters']
    map_ids = {'MAP_' + re.sub(r'(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])', '_', m).upper() for m in maps}

    wild_species: dict[str, dict[str, tuple[int, int]]] = defaultdict(dict)
    for e in wild:
        if e['map'] in map_ids:
            for field in ('land_mons', 'water_mons', 'fishing_mons', 'rock_smash_mons'):
                if field in e and (field != 'fishing_mons' or args.to != 'misty'):  # the Old Rod comes with Vermilion
                    for mon in e[field]['mons']:
                        sp = mon['species'].replace('SPECIES_', '')
                        lo, hi = wild_species[sp].get(e['map'], (99, 0))
                        wild_species[sp][e['map']] = (min(lo, mon['min_level']), max(hi, mon['max_level']))
    trainers = [t for t in (trainer(tid, trainers_h, parties_h) for tid in sorted(trainer_ids_on(maps))) if t]
    for t in trainers:
        for p in t['party']:
            if not p['moves']:
                p['moves'] = moves_at(ls[p['species']], p['level'])

    tm_moves, tm_learn = tmhm()
    tms_here = tmhm_on(maps)
    yours = set(GIFTS[args.to]) | set(wild_species)
    frontier = list(yours)
    while frontier:  # evolutions a player can reach by the level cap (stones are sold in Celadon)
        sp = frontier.pop()
        for kind, arg, to in evolutions(sp, evo):
            if to not in yours and (kind == 'LEVEL' and int(arg) <= cap or kind in ('ITEM', 'FRIENDSHIP') and args.to == 'erika'):
                yours.add(to); frontier.append(to)
    your_moves: dict[str, set[str]] = defaultdict(set)   # move -> who can have it
    for sp in yours:
        for l, m in ls.get(sp, []):
            if l <= cap:
                your_moves[m].add(sp)
        for tm in tms_here:
            if tm in tm_moves and tm_moves[tm] in tm_learn.get(sp, set()):
                your_moves[tm_moves[tm]].add(f'{sp} ({tm})')
    foe_moves: dict[str, set[str]] = defaultdict(set)
    for t in trainers:
        for p in t['party']:
            for m in p['moves']:
                if m != 'NONE':
                    foe_moves[m].add(f'{t["class"].title()} {t["name"]}')
    for sp, places in wild_species.items():
        for mp, (lo, hi) in places.items():
            for m in moves_at(ls[sp], hi):
                foe_moves[m].add(f'wild {sp}')

    coded = code_red_moves()
    all_moves = sorted(set(your_moves) | set(foe_moves))
    missing = [m for m in all_moves if m not in coded]
    if args.missing:
        for m in missing:
            who = sorted(your_moves.get(m, set()))[:3] + sorted(foe_moves.get(m, set()))[:3]
            print(f'{m}: {", ".join(who)}')
        print(f'{len(missing)} of {len(all_moves)} moves a player can meet before {args.to.title()} have no code', file=sys.stderr)
        return 1 if missing else 0

    out = [f'# Inventory: everything up to {args.to.title()} (FireRed, from the decomp data)', '',
           f'Generated by `scripts/inventory.py --to {args.to}`: wild_encounters.json, the maps\' scripts (trainers, TMs found or sold), '
           f'trainers.h, trainer_parties.h, level_up_learnsets.h (≤ L{cap}), tmhm_learnsets.h, evolution.h; Code Red names from rules/moves.mjs.', '',
           f'**{len(yours)} species a player can have · {len(all_moves)} moves in play ({len(missing)} without code) · {len(trainers)} trainers · TMs/HMs here: {", ".join(sorted(tms_here))}**', '',
           '## Moves a player can meet', '', '| FireRed | Code Red | yours (who) | foes (who) |', '|---|---|---|---|']
    for m in all_moves:
        y, f = sorted(your_moves.get(m, set())), sorted(foe_moves.get(m, set()))
        out.append(f'| {m.replace("_", " ").title()} | {coded.get(m, "**none**")} | {", ".join(y[:4])}{" …" if len(y) > 4 else ""} | {", ".join(f[:4])}{" …" if len(f) > 4 else ""} |')
    out += ['', '## Species', '', '| Pokémon | Type | Where |', '|---|---|---|']
    for sp in sorted(yours):
        where = [f'{mp.replace("MAP_", "").title().replace("_", " ")} L{lo}-{hi}' for mp, (lo, hi) in wild_species.get(sp, {}).items()]
        if sp in GIFTS[args.to]:
            where.insert(0, 'starter' if sp in ('BULBASAUR', 'CHARMANDER', 'SQUIRTLE') else 'gift')
        out.append(f'| {sp.title()} | {"/".join(species_info(sp, si)["types"]).title()} | {"; ".join(where) or "evolution"} |')
    out += ['', '## Trainers', '', '| Trainer | Party |', '|---|---|']
    for t in trainers:
        out.append(f'| {t["class"].title()} {t["name"]} | ' + '; '.join(f'{p["species"].title()} L{p["level"]} ({", ".join(coded.get(m, m) for m in p["moves"] if m != "NONE")})' for p in t['party']) + ' |')
    path = ROOT / f'notes/inventory-to-{args.to}.md'
    path.write_text('\n'.join(out) + '\n')
    print(f'{path.relative_to(ROOT)}: {len(yours)} species, {len(all_moves)} moves ({len(missing)} without code), {len(trainers)} trainers')
    if missing:
        print('without code: ' + ', '.join(missing))
    return 0


if __name__ == '__main__':
    sys.exit(main())
