#!/usr/bin/env python3
"""Battle beats in the real ROM (patch 006, 2026-10-13): while a Pokémon writes its code its sprite glows (a mint
palette pulse), and a crash glitches the sprite (jitter, red/white flashes, an error buzz) where a wrong answer
misses the plain FireRed way. First rival battle; the host answers after 90 frames: a crash, then a wrong answer.

  python3 sim/experiments/beats.py
Writes build/sim/results/beats-*.png (strips) and beats.json; exits 1 on a failed check:
  thinking glows        the attacker's palette changes while it waits, and is its own again after
  a crash glitches      the attacker's sprite moves (x2) after a crash verdict
  a wrong answer doesn't  no jitter after a wrong answer
"""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from codered import World
from codered.game import ROOT
from codered.routes import CHECKPOINTS, opening, SYS_FLAGS
from codered.battle import Battle
from codered.code_moves import CodeMoveHost

OUT = ROOT / 'build/sim/results'
PLTT_FADED = 'gPlttBufferFaded'


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    g = World()
    cp = CHECKPOINTS / 'rival_battle_charmander.state'
    if not cp.exists():
        opening(g, 'CHARMANDER')
    g.load_state(cp.read_bytes())
    for i in range(8):
        g.set_flag(SYS_FLAGS + 0x20 + i)  # no doubt
    hm = g.sym('gHitMarker'); g.w32(hm, g.u32(hm) & ~(1 << 7))  # battle animations on, as players have them
    plan = iter([('miss', 'crashed'), ('miss', 'wrong answer')])
    verdicts = {}
    def decide(r):
        if r['side'] != 0:
            return ('hit', None)
        v = verdicts.get(r['id']) or next(plan, ('hit', None))
        verdicts[r['id']] = v
        return v
    host = CodeMoveHost(g, decide, delay=90); host.attach(); host.enable()
    b = Battle(g)
    ids = g.sym('gBattlerSpriteIds'); sprites = g.sym('gSprites'); faded = g.sym(PLTT_FADED); unfaded = g.sym('gPlttBufferUnfaded')
    SPRITE = 0x44  # sizeof(struct Sprite); x2 at +0x24, oam.paletteNum: high nibble of oam byte 5
    def sprite(): return sprites + g.u8(ids) * SPRITE
    def pal_off(): return 0x100 + (g.u8(sprite() + 5) >> 4) * 16
    def pal(buf): return g.read(buf + pal_off() * 2, 32)
    def x2(): return int.from_bytes(g.read(sprite() + 0x24, 2), 'little', signed=True)
    results, strips = {}, {}
    for turn, label in ((0, 'crash'), (1, 'wrong')):
        for _ in range(400):
            if b.choosing_action(): break
            g.press('A', hold=2, after=6)
        b.act(0); g.run_until(b.choosing_move, limit=600); b.use_move(0)
        g.run_until(lambda: host.request() is not None and host.request()['side'] == 0, limit=600)
        glow, shots = 0, []
        for f in range(80):  # waiting for the code
            g.run(1)
            if pal(faded) != pal(unfaded): glow += 1
            if f in (10, 22, 34, 46): shots.append(g.screenshot(None))
        g.run(20)  # the verdict lands
        own_after = None
        moved = 0
        for f in range(90):
            g.run(1)
            if x2() != 0: moved += 1
            if f in (30, 38, 46, 54): shots.append(g.screenshot(None))
        own_after = pal(faded) == pal(unfaded)
        results[label] = {'glowing_frames': glow, 'jitter_frames': moved, 'palette_restored': own_after}
        strips[label] = shots
    from PIL import Image
    for label, shots in strips.items():
        strip = Image.new('RGB', (240 * 4, 160 * 2))
        for k, im in enumerate(shots[:8]):
            strip.paste(im.convert('RGB'), (240 * (k % 4), 160 * (k // 4)))
        strip.save(OUT / f'beats-{label}.png')
    checks = {
        'thinking glows': results['crash']['glowing_frames'] > 40 and results['wrong']['glowing_frames'] > 40,
        'its own colours again after': results['crash']['palette_restored'] and results['wrong']['palette_restored'],
        'a crash glitches': results['crash']['jitter_frames'] >= 10,
        "a wrong answer doesn't": results['wrong']['jitter_frames'] == 0,
    }
    (OUT / 'beats.json').write_text(json.dumps({'results': results, 'checks': checks}, indent=1))
    print(json.dumps(results)); print(json.dumps(checks))
    sys.exit(0 if all(checks.values()) else 1)


if __name__ == '__main__':
    main()
