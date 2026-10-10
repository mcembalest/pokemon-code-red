#!/usr/bin/env python3
"""Doubt in the real ROM (patch 006, CodeRedDoubts): in the first rival battle CHARMANDER is told to use GROWL
(instinct score 0) while SCRATCH is right there. Its chance of using SCRATCH instead is
    ½ × (1 − 0 / score(SCRATCH)) × (8 − badges) / 8  =  50% / 25% / 0%  at 0 / 4 / 8 badges.
Each trial reloads the battle with a different RNG seed; a doubt is the disobedient-move hit marker, and the move\nit used instead is gCalledMove.
Also screenshots the "doubted your call!" text once.

  python3 sim/experiments/doubt.py [trials per badge count, default 60]
Writes build/sim/results/doubt.json; exits 1 if a rate is off by more than 3 standard errors.
"""
import json, math, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from codered import World
from codered.game import ROOT
from codered.routes import CHECKPOINTS, opening, SYS_FLAGS
from codered.battle import Battle

MOVE_SCRATCH, MOVE_GROWL = 10, 45
FLAG_BADGE01_GET = SYS_FLAGS + 0x20
HITMARKER_DISOBEDIENT_MOVE = 1 << 21
OUT = ROOT / 'build/sim/results'


def trial(g: World, state: bytes, seed: int, badges: int, shot: Path | None = None) -> int:
    g.load_state(state)
    for i in range(8):
        g.set_flag(FLAG_BADGE01_GET + i, i < badges)
    g.w32(g.sym('gRngValue'), seed * 2654435761 & 0xFFFFFFFF)
    b = Battle(g)
    for _ in range(200):  # the battle intro text
        if b.choosing_action(): break
        g.press('A', hold=2, after=6)
    assert b.choosing_action(), 'no action menu'
    b.act(0)
    assert g.run_until(b.choosing_move, limit=600), 'no move menu'
    slot = g.u16(g.sym('gBattleMons') + 0x0C + 2)  # moves[1]
    assert slot == MOVE_GROWL, f'slot 1 is move {slot}, not GROWL'
    b.use_move(1)
    hit = g.sym('gHitMarker')
    used = MOVE_GROWL
    for _ in range(600):  # its move goes first (Oak's tutorial prompts come later in the turn)
        g.run(1)
        if g.u32(hit) & HITMARKER_DISOBEDIENT_MOVE:
            used = g.u16(g.sym('gCalledMove'))
            if shot:
                g.run(70); g.screenshot(shot)
            break
    return used


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 60
    OUT.mkdir(parents=True, exist_ok=True)
    cp = CHECKPOINTS / 'rival_battle_charmander.state'
    g = World()
    if not cp.exists():
        opening(g, 'CHARMANDER')
    state = cp.read_bytes()
    results, ok = {}, True
    shot = OUT / 'doubt.png'
    shot.unlink(missing_ok=True)
    for badges, expect in ((0, 0.5), (4, 0.25), (8, 0.0)):
        used = [trial(g, state, s + 1000 * badges, badges, shot if badges == 0 and not shot.exists() else None) for s in range(n)]
        scratch = sum(u == MOVE_SCRATCH for u in used) / n
        other = [u for u in used if u not in (MOVE_SCRATCH, MOVE_GROWL)]
        se = math.sqrt(max(expect * (1 - expect), 1 / n) / n)
        good = abs(scratch - expect) <= 3 * se and not other
        ok &= good
        results[badges] = {'expected': expect, 'scratch': round(scratch, 3), 'trials': n, 'other_moves': other, 'ok': good}
        print(badges, results[badges], flush=True)
    (OUT / 'doubt.json').write_text(json.dumps(results, indent=1))
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
