#!/usr/bin/env python3
"""Dress rehearsal (2026-10-10): power-on → Misty with code moves on, every move written by the real models through the
page's own brain (sim/brain.ts), both sides. Answers: can a player get through? how long do they wait on code? how many
tokens does a playthrough cost (the backend allows AI_DAILY_TOKENS = 400k a player a day)? what misses, and why?

  python3 sim/rehearse.py [--seed N] [--mock]       (real models need CLOUDFLARE_API_KEY + CLOUDFLARE_ACCOUNT_ID,
                                                     or BRAIN_API + BRAIN_TOKEN for the live game API)
Writes build/sim/rehearsal/turns.jsonl (one line per code move), summary.json, and raw states at the start of each
gym battle (gym-<map>-<trainer>.raw, for the browser rehearsal; game RAM: never publish).
"""
import argparse, json, sys, time
from collections import Counter, defaultdict
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from codered import World
from codered.game import ROOT
from codered.battle import Battle
from codered.brain_host import BrainHost
from codered import routes

OUT = ROOT / 'build/sim/rehearsal'


def summarize(turns: list[dict], legs: list[dict], result: dict, wall: float) -> dict:
    mine = [t for t in turns if t.get('side') == 0]
    foes = [t for t in turns if t.get('side') == 1]
    rate = lambda ts: round(sum(t['verdict'] == 'hit' for t in ts) / max(1, len(ts)), 3)
    by_move = defaultdict(list)
    for t in mine:
        by_move[t.get('move', '?')].append(t)
    tokens = sum((t.get('usage') or {}).get('input', 0) + (t.get('usage') or {}).get('output', 0) for t in turns)
    waits = sorted(t['wall'] for t in turns)
    return {
        **result, 'wall_seconds': round(wall), 'legs': legs,
        'code_turns': len(turns), 'your_turns': len(mine), 'foe_turns': len(foes),
        'your_hit_rate': rate(mine), 'foe_hit_rate': rate(foes),
        'your_misses': dict(Counter(t.get('reason') for t in mine if t['verdict'] == 'miss').most_common()),
        'vanilla': sum(t['verdict'] == 'vanilla' for t in turns),
        'doubted': sum(1 for t in mine if t.get('doubted_slot')),
        'payloads_delivered': sum(1 for t in turns if t.get('payload_kind')),
        'by_move': {m: {'n': len(ts), 'hit': rate(ts)} for m, ts in sorted(by_move.items(), key=lambda kv: -len(kv[1]))},
        'tokens': tokens, 'tokens_mine': sum((t.get('usage') or {}).get('input', 0) + (t.get('usage') or {}).get('output', 0) for t in mine),
        # memory is code (2026-10-11): how often your code called a helper it carried, and how that went
        'memory_used': round(sum(1 for t in mine if t.get('usedMemory')) / max(1, len(mine)), 3),
        'hit_with_memory': rate([t for t in mine if t.get('usedMemory')]),
        'hit_without_memory': rate([t for t in mine if not t.get('usedMemory') and not t.get('tutorial')]),
        'memory_bytes_mean': round(sum(t.get('memory') or 0 for t in mine) / max(1, len(mine))),
        'model_wait_seconds': round(sum(waits)), 'wait_median': waits[len(waits) // 2] if waits else 0, 'wait_p90': waits[int(len(waits) * 0.9)] if waits else 0,
    }


def main():
    global OUT
    ap = argparse.ArgumentParser()
    ap.add_argument('--seed', type=int, default=0)
    ap.add_argument('--mock', action='store_true')
    ap.add_argument('--out', default=str(OUT), help='where turns.jsonl / summary.json go (one dir per parallel run)')
    args = ap.parse_args()
    OUT = Path(args.out)
    OUT.mkdir(parents=True, exist_ok=True)
    g = World()
    host = BrainHost(g, OUT / 'turns.jsonl', mock=args.mock)
    host.attach()
    # Raw states at the first action menu of every gym battle (the browser rehearsal loads them).
    saved = set()
    def at_menu():
        m = g.map()
        trainer = g.u16(g.sym('gTrainerBattleOpponent_A'))
        if m.endswith('_GYM') and g.in_battle() and trainer in (414, 415):  # TRAINER_LEADER_BROCK, TRAINER_LEADER_MISTY
            key = f"{m.replace('MAP_', '').lower()}-{trainer}"
            if key not in saved:
                saved.add(key)
                (OUT / f'gym-{key}.raw').write_bytes(g.save_state()[:-8])
    play = Battle.play
    def play_and_save(self, *a, **k):
        if g.map().endswith('_GYM') and g.mash(self.choosing_action, 'A', limit=3000, period=20):  # through the intro text
            at_menu()
        return play(self, *a, **k)
    Battle.play = play_and_save

    legs, t0 = [], time.time()
    def log(line: str):
        print(line, flush=True)
        if not line.startswith(' '):
            legs.append({'leg': line.split()[0], 'ok': ' ok ' in line, 'wall_s': round(time.time() - t0), 'line': line.strip(),
                         'code_turns': len(host.turns)})
    try:
        result = routes.to_misty(g, seed=args.seed, log=log)
        result['ok'] = True
    except Exception as e:  # a failed leg, or the brain died
        result = {'ok': False, 'error': f'{type(e).__name__}: {e}', 'frame': g.frame, 'map': g.map(), 'party': g.party()}
        g.screenshot(OUT / 'fail.png')
    finally:
        host.close()
    s = summarize(host.turns, legs, result, time.time() - t0)
    s['consolidations'] = len(host.memories)
    s['consolidations_kept_bytes'] = [sum(len(h['src']) for h in m.get('after') or []) for m in host.memories]
    s['tokens'] += sum((m.get('usage') or {}).get('input', 0) + (m.get('usage') or {}).get('output', 0) for m in host.memories)
    s['gym_states'] = sorted(saved)
    (OUT / 'summary.json').write_text(json.dumps(s, indent=1, default=str))
    print(json.dumps({k: v for k, v in s.items() if k not in ('legs', 'party')}, indent=1, default=str))
    sys.exit(0 if result['ok'] else 1)


if __name__ == '__main__':
    main()
