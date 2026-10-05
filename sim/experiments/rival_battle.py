#!/usr/bin/env python3
"""Outcome distribution of the first rival battle, N reseeded branches per policy.

  python3 sim/experiments/rival_battle.py [--n 100] [--starter BULBASAUR] [--workers 8]

Needs the checkpoint from `python3 sim/run.py opening` (or creates it).
Writes build/sim/results/rival_battle.json and prints a summary.
"""
import argparse, collections, json, statistics, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from codered.game import ROOT
from codered.routes import CHECKPOINTS
from codered.parallel import branches
from codered.battle import fight_first_move, fight_random


def summarize(rows):
    out = {}
    for policy in sorted({r['policy'] for r in rows}):
        rs = [r for r in rows if r['policy'] == policy]
        counts = collections.Counter(r['outcome'] for r in rs)
        won = [r for r in rs if r['outcome'] == 'won']
        out[policy] = {
            'n': len(rs),
            'win_rate': round(len(won) / len(rs), 3),
            'outcomes': dict(counts),
            'battle_seconds_game_time_median': round(statistics.median(r['frames'] for r in rs) / 59.73, 1),
            'hp_left_when_won_median': statistics.median(r['player_hp'] for r in won) if won else None,
            'timed_out': sum(r['timed_out'] for r in rs),
        }
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--n', type=int, default=100)
    ap.add_argument('--starter', default='BULBASAUR')
    ap.add_argument('--workers', type=int, default=None)
    args = ap.parse_args()
    cp = CHECKPOINTS / f'rival_battle_{args.starter.lower()}.state'
    if not cp.exists():
        sys.exit(f'missing {cp}: run python3 sim/run.py opening --starter {args.starter}')
    state = cp.read_bytes()
    t = time.time()
    rows = []
    for trial in (fight_first_move, fight_random):
        rows += branches(state, trial, range(args.n), args.workers)
    wall = time.time() - t
    game_frames = sum(r['frames'] for r in rows)
    report = {'starter': args.starter, 'summary': summarize(rows), 'wall_seconds': round(wall, 1),
              'game_time_simulated_minutes': round(game_frames / 59.73 / 60, 1),
              'speedup_vs_realtime': round(game_frames / 59.73 / wall), 'rows': rows}
    out = ROOT / 'build/sim/results/rival_battle.json'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2))
    print(json.dumps({k: v for k, v in report.items() if k != 'rows'}, indent=2))


if __name__ == '__main__':
    main()
