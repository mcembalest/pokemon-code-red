#!/usr/bin/env python3
"""Pull the FireRed facts the strategy simulator needs from the pinned decomp (.cache/pokefirered).

  python3 models/strategy/extract.py      -> models/strategy/kanto.json

Species (base stats, types, level-up learnsets), all moves (effect, power, type, accuracy, pp, effect chance,
priority), the type chart, and every trainer party (species, level, iv, custom moves). Numbers only.
"""
import json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / '.cache/pokefirered'
OUT = Path(__file__).with_name('kanto.json')


def read(p):
    return (SRC / p).read_text()


def blocks(text, key_re):
    """[KEY] = { ... } entries (one nesting level)."""
    out = {}
    for m in re.finditer(r'\[(' + key_re + r')\]\s*=\s*\{', text):
        i, depth = m.end(), 1
        while depth:
            depth += {'{': 1, '}': -1}.get(text[i], 0); i += 1
        out[m.group(1)] = text[m.end():i - 1]
    return out


def field(body, name, default=None):
    m = re.search(r'\.' + name + r'\s*=\s*([^,\n]+(?:\{[^}]*\})?)', body)
    return m.group(1).strip() if m else default


def num(v, default=0):
    try: return int(v, 0)
    except (TypeError, ValueError): return default


def main():
    species = {}
    for key, body in blocks(read('src/data/pokemon/species_info.h'), r'SPECIES_[A-Z0-9_]+').items():
        types = re.search(r'\.types\s*=\s*\{(TYPE_\w+),\s*(TYPE_\w+)\}', body)
        abil = re.search(r'\.abilities\s*=\s*\{(ABILITY_\w+),\s*(ABILITY_\w+)\}', body)
        if not types: continue
        species[key[8:]] = {
            'base': [num(field(body, f)) for f in ('baseHP', 'baseAttack', 'baseDefense', 'baseSpeed', 'baseSpAttack', 'baseSpDefense')],
            'types': [types.group(1)[5:], types.group(2)[5:]],
            'abilities': [abil.group(1)[8:], abil.group(2)[8:]] if abil else ['NONE', 'NONE'],
            'growth': (field(body, 'growthRate') or '').replace('GROWTH_', ''),
            'exp': num(field(body, 'expYield')),
        }
    # learnsets
    ptrs = dict(re.findall(r'\[SPECIES_(\w+)\]\s*=\s*(s\w+LevelUpLearnset)', read('src/data/pokemon/level_up_learnset_pointers.h')))
    sets = {}
    for m in re.finditer(r'static const u16 (s\w+LevelUpLearnset)\[\] = \{(.*?)\};', read('src/data/pokemon/level_up_learnsets.h'), re.S):
        sets[m.group(1)] = [[int(l), mv] for l, mv in re.findall(r'LEVEL_UP_MOVE\(\s*(\d+),\s*MOVE_(\w+)\)', m.group(2))]
    for s, p in ptrs.items():
        if s in species: species[s]['learnset'] = sets.get(p, [])
    # moves
    moves = {}
    for key, body in blocks(read('src/data/battle_moves.h'), r'MOVE_[A-Z0-9_]+').items():
        moves[key[5:]] = {
            'effect': (field(body, 'effect') or 'EFFECT_HIT').replace('EFFECT_', ''),
            'power': num(field(body, 'power')), 'type': (field(body, 'type') or 'TYPE_NORMAL')[5:],
            'acc': num(field(body, 'accuracy')), 'pp': num(field(body, 'pp')),
            'chance': num(field(body, 'secondaryEffectChance')), 'priority': num(field(body, 'priority')),
            'target': (field(body, 'target') or '').replace('MOVE_TARGET_', ''),
        }
    # type chart: attacker, defender, multiplier x10
    chart = []
    text = read('src/battle_main.c')
    body = text[text.index('gTypeEffectiveness'):]
    body = body[:body.index('};')]
    mult = {'TYPE_MUL_NO_EFFECT': 0, 'TYPE_MUL_NOT_EFFECTIVE': 5, 'TYPE_MUL_NORMAL': 10, 'TYPE_MUL_SUPER_EFFECTIVE': 20}
    for a, d, m in re.findall(r'(TYPE_\w+),\s*(TYPE_\w+),\s*(TYPE_MUL_\w+)', body):
        if a == 'TYPE_FORESIGHT': break
        chart.append([a[5:], d[5:], mult[m]])
    # trainer parties
    parties = {}
    for m in re.finditer(r'static const struct TrainerMon(\w+) (sParty_\w+)\[\] = \{(.*?)\n\};', read('src/data/trainer_parties.h'), re.S):
        mons = []
        for mon in re.findall(r'\{(.*?)\}', m.group(3).replace('.moves = {', '.moves = [').replace('MOVE_NONE}', 'MOVE_NONE]'), re.S):
            sp = re.search(r'\.species\s*=\s*SPECIES_(\w+)', mon)
            if not sp: continue
            mv = re.search(r'\.moves\s*=\s*\[([^\]]*)', mon)
            mons.append({'species': sp.group(1), 'level': num(field(mon, 'lvl')), 'iv': num(field(mon, 'iv')),
                         'moves': [x.strip()[5:] for x in mv.group(1).split(',') if x.strip() and x.strip() != 'MOVE_NONE'] if mv else None})
        parties[m.group(2)] = mons
    trainers = {}
    for key, body in blocks(read('src/data/trainers.h'), r'TRAINER_[A-Z0-9_]+').items():
        p = re.search(r'\((sParty_\w+)\)', body)
        if p and p.group(1) in parties:
            trainers[key[8:]] = {'class': (field(body, 'trainerClass') or '').replace('TRAINER_CLASS_', ''), 'party': parties[p.group(1)]}
    OUT.write_text(json.dumps({'source': 'pret/pokefirered (upstream.lock.json)', 'species': species, 'moves': moves, 'chart': chart, 'trainers': trainers}, separators=(',', ':')))
    print(f'{len(species)} species, {len(moves)} moves, {len(chart)} chart rows, {len(trainers)} trainers -> {OUT}')


if __name__ == '__main__':
    main()
