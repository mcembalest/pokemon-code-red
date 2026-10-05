#!/usr/bin/env python3
"""Simulator entry points.

  python3 sim/run.py misty [--seed N]   play power-on -> 2nd gym, report
  python3 sim/run.py opening            power-on -> first rival battle checkpoint
"""
import argparse, json, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from codered import World
from codered.routes import to_misty, opening, progress_trace, CHECKPOINTS
from codered.game import ROOT


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('route', choices=['misty', 'opening'])
    ap.add_argument('--seed', type=int, default=None, help='branch: wait seed*7 extra frames on the title screen (FireRed seeds its RNG on START)')
    ap.add_argument('--trace', action='store_true')
    args = ap.parse_args()
    g = World()
    if args.trace:
        g.trace = progress_trace(ROOT / 'build/sim/trace.png')
    t = time.time()
    try:
        result = to_misty(g, seed=args.seed or 0) if args.route == 'misty' else {'ok': opening(g, title_wait=(args.seed or 0) * 7)}
        result['ok'] = True
    except RuntimeError as e:
        result = {'ok': False, 'error': str(e), 'frame': g.frame, 'map': g.map()}
    result['wall_seconds'] = round(time.time() - t, 1)
    result['speedup'] = round(g.frame / 59.73 / max(result['wall_seconds'], 0.1))
    out = ROOT / f'build/sim/results/{args.route}' + (f'-seed{args.seed}' if args.seed is not None else '') + '.json'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))
    sys.exit(0 if result['ok'] else 1)


if __name__ == '__main__':
    main()
