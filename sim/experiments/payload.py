#!/usr/bin/env python3
"""Payload moves in the real ROM (patches/009-payload.patch): the first rival battle, CHARMANDER's ERROR (Growl)
hands the game the reference growl (rules/payload.mjs); FLASH (poked into move slot 2) hands it the 4-frame starburst
in its palette. Checks the game takes each payload (`played` counts up) and the battle goes on, and screenshots the
starburst every few frames (payload-flash-strip.png: does it animate?). How sounds play: sim/experiments/payload_audio.py. All eight badges are set so CHARMANDER
never doubts these calls (both moves score 0 to its instinct; sim/experiments/doubt.py covers doubt).

  python3 sim/experiments/payload.py
Writes build/sim/results/payload.json; exits 1 on a failed check.
"""
import json, subprocess, sys
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
REFS = json.loads(subprocess.run(['node', '-e', "import('./rules/index.mjs').then(r => { const b = [42, 13, 140, 77]; "
    "console.log(JSON.stringify({ growl: r.PAYLOAD.growl.ref(b), flash: r.PAYLOAD.flash.ref(b), palette: r.PAYLOAD.flash.palette })) })"],
    cwd=ROOT, capture_output=True, text=True, check=True).stdout)


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
            payload.deliver('sound', REFS['growl']); delivered.append('sound'); return ('hit', None)
        if r['side'] == 0 and r['move'] == MOVE_FLASH:
            payload.deliver('image', REFS['flash'], REFS['palette']); delivered.append('image'); return ('hit', None)
        return ('hit', None)
    host = CodeMoveHost(g, decide); host.attach(); host.enable()
    b = Battle(g)
    shots = []
    base = g.sym('gBattleMons')
    # slot 1 = ERROR (Growl) until its sound is taken, then slot 2 = FLASH until its picture is; the first battle's
    # tutorial text can eat a press and a turn can go to another move, so each is retried on the next turn
    turns, frame0, poked = 0, g.frame, False
    changes = 0
    while not b.over() and turns < 8 and g.frame - frame0 < 60 * 60 * 4 and not shots:
        if b.choosing_action():
            if not poked:  # once the battle has loaded its Pokémon: give CHARMANDER FLASH in slot 2 so both payload kinds get used
                g.w16(base + BMON_MOVES + 2 * 2, MOVE_FLASH); g.w8(base + BMON_PP + 2, 20); poked = True
            b.act(0)
        elif b.choosing_move():
            want_image = 'sound' in delivered and payload.played() >= 1
            b.use_move(2 if want_image else 1); turns += 1
            if want_image and g.run_until(lambda: payload.played() >= 2, limit=1500):  # FLASH's hit landed: the sprite animates now
                from PIL import Image
                frames = []
                for k in range(8):
                    g.run(6); p = OUT / f'payload-flash-{k}.png'; g.screenshot(p); frames.append(Image.open(p).convert('RGB'))
                strip = Image.new('RGB', (240 * 4, 160)); [strip.paste(frames[k * 2], (240 * k, 0)) for k in range(4)]
                strip.save(OUT / 'payload-flash-strip.png'); shots.append(str(OUT / 'payload-flash-strip.png'))
                region = (120, 0, 240, 100)
                changes = sum(1 for k in range(1, 4) if list(frames[k].crop(region).getdata()) != list(frames[k - 1].crop(region).getdata()))
        else:
            g.press('A', hold=2, after=6)
    g.run(400)  # the last hit lands
    results = {'delivered': delivered, 'played': payload.played(), 'kind_after': payload.kind(), 'turns': turns,
               'requests': [{k: r[k] for k in ('move', 'side')} for r in host.requests], 'outcome': g.battle_outcome(), 'shots': shots, 'flash_frames_changing': changes}
    (OUT / 'payload.json').write_text(json.dumps(results, indent=1))
    print(json.dumps(results))
    checks = {'both kinds delivered': set(delivered) >= {'sound', 'image'}, 'game played every payload': results['played'] == len(delivered) and results['played'] >= 2,
              'kind cleared': results['kind_after'] == 0, 'battle went on': results['outcome'] in ('ongoing', 'won', 'lost'),
              'the starburst animated': changes >= 2}
    print(json.dumps(checks))
    sys.exit(0 if all(checks.values()) else 1)


if __name__ == '__main__':
    main()
