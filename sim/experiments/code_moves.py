#!/usr/bin/env python3
"""Check code moves in the real ROM: the first rival battle under four hosts.

  python3 sim/experiments/code_moves.py [--starter CHARMANDER]

  none     no host: plain FireRed, the battle ends
  hit      every code hits: plain FireRed outcome too (accuracy roll still applies)
  miss     every code crashes: nobody loses HP; the text box says "...code crashed!"
  mixed    the player's code hits, the foe's code is wrong: only the foe loses HP

Needs the checkpoint from `python3 sim/run.py opening` with the same starter (or makes it).
Writes build/sim/results/code_moves.json (+ a screenshot of the miss text); exits 1 on a failed check.
"""
import argparse, json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from codered import World
from codered.game import ROOT
from codered.routes import CHECKPOINTS, opening
from codered.battle import Battle
from codered.code_moves import CodeMoveHost

HOSTS = {
    'none': None,
    'hit': lambda r: ('hit', None),
    'miss': lambda r: ('miss', 'crashed'),
    'mixed': lambda r: ('hit', None) if r['side'] == 0 else ('miss', 'wrong answer'),
}


def trial(g: World, state: bytes, host_name: str, shots: Path, turns_limit: int = 8) -> dict:
    g.load_state(state)
    g.run = type(g).run.__get__(g)  # undo the previous host's wrapper
    host = None
    if HOSTS[host_name]:
        host = CodeMoveHost(g, HOSTS[host_name])
        host.attach()
        host.enable()
    b = Battle(g)
    start = None  # full HP, read once the battle has loaded its Pokémon
    shot = None
    limit = 60 * 60 * (2 if host_name in ('miss',) else 10)
    frame0, moves = g.frame, 0
    while not b.over() and g.frame - frame0 < limit and moves < (turns_limit if host_name == 'miss' else 99):
        if b.choosing_action():
            start = start or (b.mon(0)['max_hp'], b.mon(1)['max_hp'])
            b.act(0)
        elif b.choosing_move():
            b.use_move(b.best_move()); moves += 1
        else:
            g.press('A', hold=2, after=6)
        if host_name == 'miss' and shot is None and host.requests and g.frame - host.requests[0]['frame'] > 150:
            shot = shots / 'code-moves-miss.png'
            g.screenshot(shot)
    end = (b.mon(0)['hp'], b.mon(1)['hp'])
    reqs = host.requests if host else []
    return {'host': host_name, 'outcome': g.battle_outcome(), 'hp_start': start, 'hp_end': end, 'player_moves': moves,
            'requests': len(reqs), 'sides': sorted({r['side'] for r in reqs}),
            'sample': reqs[:2], 'all_requests': [{k: r[k] for k in ('id', 'move', 'side', 'stages')} for r in reqs], 'screenshot': str(shot) if shot else None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--starter', default='CHARMANDER')
    args = ap.parse_args()
    cp = CHECKPOINTS / f'rival_battle_{args.starter.lower()}.state'
    g = World()  # one per process
    if not cp.exists():
        opening(g, args.starter)
    state = cp.read_bytes()
    shots = ROOT / 'build/sim/results'
    shots.mkdir(parents=True, exist_ok=True)
    rows = [trial(g, state, h, shots) for h in HOSTS]
    by = {r['host']: r for r in rows}
    checks = {
        'no host: battle ends': by['none']['outcome'] in ('won', 'lost'),
        'no host: no requests': by['none']['requests'] == 0,
        'hit: battle ends': by['hit']['outcome'] in ('won', 'lost'),
        'hit: both sides ask': by['hit']['sides'] == [0, 1],
        'miss: nobody loses HP': by['miss']['hp_end'] == by['miss']['hp_start'],
        'miss: both sides ask': by['miss']['sides'] == [0, 1],
        'mixed: player never loses HP (it may level up)': by['mixed']['hp_end'][0] >= by['mixed']['hp_start'][0],
        'mixed: player wins': by['mixed']['outcome'] == 'won',
        'stages reported: after the rival\'s TAIL WHIP (39) the player writes with a negative sum': any(r['stages'] < 0 for r in by['hit']['all_requests'] if r['side'] == 0) or not any(r['move'] == 39 for r in by['hit']['all_requests']),
    }
    report = {'starter': args.starter, 'checks': checks, 'rows': rows}
    (shots / 'code_moves.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    sys.exit(0 if all(checks.values()) else 1)


if __name__ == '__main__':
    main()
