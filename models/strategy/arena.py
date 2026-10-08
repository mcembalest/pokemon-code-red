#!/usr/bin/env python3
"""Win rates: a player's party vs a trainer, many seeds, for pairs of policies.

  python3 models/strategy/arena.py brock --starter CHARMANDER --level 13 --n 400
"""
from __future__ import annotations
import argparse, json, random, statistics, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from engine import DATA, Battle, CodeModel, Mon, party
from policies import POLICIES, make_search

HERE = Path(__file__).parent
TRAINERS = {'brock': 'LEADER_BROCK', 'misty': 'LEADER_MISTY', 'liam': 'CAMPER_LIAM'}


def code_model(scale=1.0):
    p = HERE / 'move-table.json'
    table = json.loads(p.read_text())['table'] if p.exists() else None
    return CodeModel(table, scale=scale)


def run(player_spec, trainer, mine, theirs, n, code, code_on=True, player_known=(), foe_known=(), seed=1):
    wins, turns, misses = 0, [], [0, 0]
    for k in range(n):
        rng = random.Random(seed * 100003 + k)
        a = [Mon(sp, lv, rng.randint(0, 31), mv, known=set(player_known)) for sp, lv, mv in player_spec]
        b = party(DATA['trainers'][trainer]['party'], known=foe_known)
        bt = Battle(a, b, code, rng, code_on=code_on)
        while not bt.over() and bt.turns < 100:
            bt.step([mine(bt, 0, rng), theirs(bt, 1, rng)])
        wins += bt.winner() == 0; turns.append(bt.turns)
        for s in (0, 1): misses[s] += bt.stats['code_miss'][s] / max(1, bt.stats['moves'][s])
    return {'win': round(wins / n, 3), 'turns': statistics.median(turns), 'code_miss': [round(m / n, 2) for m in misses]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('trainer', choices=list(TRAINERS))
    ap.add_argument('--starter', default='CHARMANDER')
    ap.add_argument('--level', type=int, default=13)
    ap.add_argument('--n', type=int, default=300)
    ap.add_argument('--search', type=int, default=0, help='rollouts for the search policy (0 = skip)')
    a = ap.parse_args()
    trainer = TRAINERS[a.trainer]
    spec = [(a.starter, a.level, None)]
    code = code_model()
    known = ['ROCK', 'GROUND'] if a.trainer == 'brock' else ['WATER', 'PSYCHIC']
    rows = []
    t0 = time.time()
    for code_on in (False, True):
        for mine in ('power', 'code', 'firered'):
            for theirs in ('firered', 'power'):
                r = run(spec, trainer, POLICIES[mine], POLICIES[theirs], a.n, code, code_on, known, [])
                rows.append({'code': code_on, 'you': mine, 'leader': theirs, **r})
                print(json.dumps(rows[-1]), flush=True)
    if a.search:
        r = run(spec, trainer, make_search(a.search), POLICIES['firered'], max(40, a.n // 10), code, True, known, [])
        rows.append({'code': True, 'you': f'search{a.search}', 'leader': 'firered', **r}); print(json.dumps(rows[-1]), flush=True)
        r = run(spec, trainer, POLICIES['power'], make_search(a.search), max(40, a.n // 10), code, True, known, [])
        rows.append({'code': True, 'you': 'power', 'leader': f'search{a.search}', **r}); print(json.dumps(rows[-1]), flush=True)
    print(f'{time.time() - t0:.0f}s')


if __name__ == '__main__':
    main()
