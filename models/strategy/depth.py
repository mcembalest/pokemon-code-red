#!/usr/bin/env python3
"""Strategy depth: how much does thinking beat 'always the strongest move'?

  python3 models/strategy/depth.py [--n 300] [--search-n 60] [--rollouts 24] [--out build/strategy/depth.json]

For each gym fight x starter x rule variant: win rate with the `power` policy (new player), `code` policy
(knows its coding odds), and `search` (rollout planner). depth = search - power.
Rule variants for status moves: off (FireRed), add (stat moves also move the target's code focus),
replace (stat moves only move code focus).
"""
from __future__ import annotations
import argparse, json, random, statistics, sys, time
from multiprocessing import Pool
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from engine import DATA, Battle, Mon, party
from policies import POLICIES, make_search
from arena import code_model

RIVAL_VS = {'CHARMANDER': 'SQUIRTLE', 'SQUIRTLE': 'BULBASAUR', 'BULBASAUR': 'CHARMANDER'}
FIGHTS = {  # trainer, player level per starter, formats the player can read (gym trainers teach)
    'brock': ('LEADER_BROCK', {'CHARMANDER': 14, 'SQUIRTLE': 12, 'BULBASAUR': 12}, ['ROCK', 'GROUND']),
    'rival': (None, {'CHARMANDER': 18, 'SQUIRTLE': 18, 'BULBASAUR': 18}, ['NORMAL', 'FLYING']),
    'misty': ('LEADER_MISTY', {'CHARMANDER': 21, 'SQUIRTLE': 20, 'BULBASAUR': 19}, ['WATER']),
}


def one(job):
    fight, starter, mode, pol, leader_knows, n, rollouts, seed = job
    trainer, levels, known = FIGHTS[fight]
    trainer = trainer or f'RIVAL_CERULEAN_{RIVAL_VS[starter]}'
    code = code_model()
    mine = make_search(rollouts) if pol == 'search' else POLICIES[pol]
    theirs = POLICIES['firered']
    wins, turns = 0, []
    for k in range(n):
        rng = random.Random(seed * 7919 + k)
        lv = levels[starter]
        a = [Mon(starter, lv, rng.randint(0, 31), known=set(known))]
        foe_known = set(SPECIESTYPES(starter)) if leader_knows else set()
        b = party(DATA['trainers'][trainer]['party'], known=foe_known)
        bt = Battle(a, b, code, rng, code_effects=mode)
        while not bt.over() and bt.turns < 100:
            bt.step([mine(bt, 0, rng), theirs(bt, 1, rng)])
        wins += bt.winner() == 0; turns.append(bt.turns)
    return {'fight': fight, 'starter': starter, 'mode': mode, 'policy': pol, 'leader_knows': leader_knows, 'n': n,
            'win': round(wins / n, 3), 'turns': statistics.median(turns)}


def SPECIESTYPES(sp):
    return DATA['species'][sp]['types']


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--n', type=int, default=300)
    ap.add_argument('--search-n', type=int, default=60)
    ap.add_argument('--rollouts', type=int, default=24)
    ap.add_argument('--fights', default='brock,rival,misty')
    ap.add_argument('--out', default='build/strategy/depth.json')
    a = ap.parse_args()
    jobs = []
    for fight in a.fights.split(','):
        for starter in ('CHARMANDER', 'SQUIRTLE', 'BULBASAUR'):
            for mode in ('off', 'add', 'replace'):
                for knows in (False, True):
                    for pol in ('power', 'code', 'firered'):
                        jobs.append((fight, starter, mode, pol, knows, a.n, 0, 11))
                    if not knows: jobs.append((fight, starter, mode, 'search', knows, a.search_n, a.rollouts, 11))
    t0 = time.time()
    rows = []
    with Pool(2) as pool:
        for r in pool.imap_unordered(one, sorted(jobs, key=lambda j: j[3] != 'search')):
            rows.append(r); print(json.dumps(r), flush=True)
    out = Path(a.out); out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({'rows': rows, 'seconds': round(time.time() - t0)}, indent=1))
    print(f'{time.time() - t0:.0f}s -> {out}')


if __name__ == '__main__':
    main()
