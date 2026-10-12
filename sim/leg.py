#!/usr/bin/env python3
"""Replay one leg (or a range) of the route from its checkpoint, with the stand-in model: seconds to a bug instead of
a run from power-on. Checkpoints come from any earlier run of this ROM build (sim/rehearse.py, sim/run.py, or this
script): build/sim/checkpoints/<CODERED_RUN>/<leg>.state.

  python3 sim/leg.py route10                 the leg after the 'surge' checkpoint
  python3 sim/leg.py route10 --to erika      several legs on
  python3 sim/leg.py opening --to misty      from power-on (no checkpoint needed)
  python3 sim/leg.py erika --trace           a line + screenshot every 6000 frames (build/sim/trace.png)
  python3 sim/leg.py --list                  the legs, and which have a checkpoint
  python3 sim/leg.py --at fail-cerulean      load a saved state (a failure's) and drop into a Python prompt with `g`

Fails leave build/sim/checkpoints/<run>/fail-<leg>.png. Real models: --real (needs the Cloudflare env, costs tokens).
"""
import argparse, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from codered import World
from codered import routes
from codered.brain_host import BrainHost
from codered.game import ROOT


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('leg', nargs='?', choices=routes.LEG_NAMES, help='first leg to play')
    ap.add_argument('--to', choices=routes.LEG_NAMES, help='last leg to play (default: the first one only)')
    ap.add_argument('--list', action='store_true')
    ap.add_argument('--trace', action='store_true')
    ap.add_argument('--real', action='store_true', help='the real models write the code (default: the stand-in)')
    ap.add_argument('--seed', type=int, default=0)
    ap.add_argument('--at', help='load this checkpoint (fail-<leg> after a failure) and open a Python prompt')
    args = ap.parse_args()
    if args.at:
        g = World()
        routes.load_checkpoint(g, args.at)
        host = BrainHost(g, ROOT / 'build/sim/leg-turns.jsonl', mock=not args.real)
        host.attach()
        info = routes.checkpoint_path(args.at).with_suffix('.json')
        print(info.read_text() if info.exists() else f'{g.map()} {g.pos()} frame {g.frame}')
        import code
        code.interact(banner='g = the world (g.map(), g.pos(), g.walk_to(x, y), g.screenshot(path), routes.*); Ctrl-D to quit',
                      local={'g': g, 'routes': routes, 'host': host})
        host.close()
        return 0
    if args.list or not args.leg:
        for n in routes.LEG_NAMES:
            print(f'{"✓" if routes.checkpoint_path(n).exists() else " "} {n}')
        print(f'checkpoints: {routes.CHECKPOINTS}')
        return 0
    g = World()
    i = routes.LEG_NAMES.index(args.leg)
    start = routes.LEG_NAMES[i - 1] if i else None
    if start:
        routes.load_checkpoint(g, start)
        print(f'from checkpoint {start}: {g.map()} {g.pos()} frame {g.frame}', flush=True)
    host = BrainHost(g, ROOT / 'build/sim/leg-turns.jsonl', mock=not args.real)
    host.attach()
    if args.trace:
        g.trace = routes.progress_trace(ROOT / 'build/sim/trace.png')
    t0 = time.time()
    try:
        routes.play(g, start=start, to=args.to or args.leg, seed=args.seed)
    except RuntimeError as e:
        print(f'{e} after {time.time() - t0:.0f}s: {g.map()} {g.pos()} frame {g.frame}; see {routes.CHECKPOINTS}/fail-*.png')
        return 1
    finally:
        host.close()
    print(f'done in {time.time() - t0:.0f}s; {len(host.turns)} code turns')
    return 0


if __name__ == '__main__':
    sys.exit(main())
