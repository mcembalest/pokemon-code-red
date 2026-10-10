#!/usr/bin/env python3
"""Payload moves in the real ROM (patches/009-payload.patch): the first rival battle, CHARMANDER's ERROR (Growl)
hands the game a buzz; FLASH (poked into move slot 2) hands it a picture. Checks the game takes each payload
(`played` counts up), the battle goes on, and screenshots the sprite. All eight badges are set so CHARMANDER
never doubts these calls (both moves score 0 to its instinct; sim/experiments/doubt.py covers doubt).

  python3 sim/experiments/payload.py
Writes build/sim/results/payload.json; exits 1 on a failed check.
"""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from codered import World
from codered.game import ROOT
from codered.routes import CHECKPOINTS, opening, SYS_FLAGS
from codered.battle import Battle, BMON_MOVES, BMON_PP
from codered.code_moves import CodeMoveHost, PayloadHost
from codered.world import BMON_SIZE

MOVE_GROWL, MOVE_FLASH = 45, 148
OUT = ROOT / 'build/sim/results'
BUZZ = [4] + [230 if i % 20 < 10 else 30 for i in range(399)]
SQUARE = [4] + [0 if 10 <= (k + 1) % 32 < 22 and 10 <= (k + 1) // 32 < 22 else 255 for k in range(1023)]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    cp = CHECKPOINTS / 'rival_battle_charmander.state'
    g = World()
    if not cp.exists():
        opening(g, 'CHARMANDER')
    g.load_state(cp.read_bytes())
    for i in range(8):
        g.set_flag(SYS_FLAGS + 0x20 + i)  # FLAG_BADGE01_GET … 08: no doubt
    payload = PayloadHost(g)
    delivered = []

    def decide(r):
        if r['side'] == 0 and r['move'] == MOVE_GROWL:
            payload.deliver('sound', BUZZ); delivered.append('sound'); return ('hit', None)
        if r['side'] == 0 and r['move'] == MOVE_FLASH:
            payload.deliver('image', SQUARE); delivered.append('image'); return ('hit', None)
        return ('hit', None)
    host = CodeMoveHost(g, decide); host.attach(); host.enable()
    b = Battle(g)
    shots = []
    base = g.sym('gBattleMons')
    plan = [1, 2, 1, 2]  # slot 1 = ERROR (Growl), slot 2 = FLASH
    turns, frame0, poked = 0, g.frame, False
    while not b.over() and turns < 4 and g.frame - frame0 < 60 * 60 * 3:
        if b.choosing_action():
            if not poked:  # once the battle has loaded its Pokémon: give CHARMANDER FLASH in slot 2 so both payload kinds get used
                g.w16(base + BMON_MOVES + 2 * 2, MOVE_FLASH); g.w8(base + BMON_PP + 2, 20); poked = True
            b.act(0)
        elif b.choosing_move():
            b.use_move(plan[turns]); turns += 1
            if turns == 2:  # FLASH just chosen: the sprite shows when the hit lands
                g.run_until(lambda: payload.played() >= 2, limit=1200)
                g.run(30); p = OUT / 'payload-flash.png'; g.screenshot(p); shots.append(str(p))
        else:
            g.press('A', hold=2, after=6)
    g.run(400)  # the last hit lands
    results = {'delivered': delivered, 'played': payload.played(), 'kind_after': payload.kind(), 'turns': turns,
               'requests': [{k: r[k] for k in ('move', 'side')} for r in host.requests], 'outcome': g.battle_outcome(), 'shots': shots}
    (OUT / 'payload.json').write_text(json.dumps(results, indent=1))
    print(json.dumps(results))
    checks = {'both kinds delivered': set(delivered) >= {'sound', 'image'}, 'game played every payload': results['played'] == len(delivered) and results['played'] >= 2,
              'kind cleared': results['kind_after'] == 0, 'battle went on': results['outcome'] in ('ongoing', 'won', 'lost')}
    print(json.dumps(checks))
    sys.exit(0 if all(checks.values()) else 1)


if __name__ == '__main__':
    main()
