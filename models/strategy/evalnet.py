#!/usr/bin/env python3
"""Evaluate a trained decision net against the gym fights: win rate vs `power` and `code`, and which moves it uses.
  python3 models/strategy/evalnet.py build/strategy/net-add.npz --mode add
"""
import argparse, collections, json, random, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from engine import DATA, Battle, Mon, party
from policies import POLICIES
from learn import load, net_policy
from arena import code_model
from depth import FIGHTS, RIVAL_VS

ap = argparse.ArgumentParser(); ap.add_argument('net'); ap.add_argument('--mode', default='add'); ap.add_argument('--n', type=int, default=300)
a = ap.parse_args()
P = load(a.net); net = net_policy(P)
code = code_model()
out = []
for fight in ('brock', 'misty'):
    trainer, levels, known = FIGHTS[fight]
    for starter in ('CHARMANDER', 'SQUIRTLE', 'BULBASAUR'):
        row = {'fight': fight, 'starter': starter}
        for name, pol in (('power', POLICIES['power']), ('code', POLICIES['code']), ('net', net)):
            wins, used = 0, collections.Counter()
            for k in range(a.n):
                rng = random.Random(500 + k)
                me = [Mon(starter, levels[starter], rng.randint(0, 31), known=set(known))]
                bt = Battle(me, party(DATA['trainers'][trainer]['party']), code, rng, code_effects=a.mode)
                while not bt.over() and bt.turns < 100:
                    i = pol(bt, 0, rng)
                    if name == 'net' and i >= 0: used[bt.mon(0).moves[i]] += 1
                    bt.step([i, POLICIES['firered'](bt, 1, rng)])
                wins += bt.winner() == 0
            row[name] = round(wins / a.n, 3)
            if name == 'net': row['net_moves'] = dict(used.most_common())
        out.append(row); print(json.dumps(row), flush=True)
