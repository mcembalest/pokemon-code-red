#!/usr/bin/env python3
"""What the GBA really does with a sound payload (patch 009). Plays the move with the payload in the first rival battle
and watches the m4a sound engine every frame: the direct-sound channel whose wave is the payload, how fast its sample
counter runs (the playback rate) and how far it gets. Also records the whole in-game mix (battle music included), the
way a player hears it, to build/sim/results/payload-audio-<name>.wav.

  python3 sim/experiments/payload_audio.py [growl] [--on-growl]   (voices: sim/experiments/move_sounds.py)
By default the payload rides on SCRATCH (its animation uses a sound effect); --on-growl puts it on GROWL, whose
animation also plays CHARMANDER's own cry on the same cry player (which wins?).
Exits 1 unless the channel plays at 8000 Hz ± 3% through ≥ 95% of the samples.
"""
import array, json, subprocess, sys, wave
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from codered import World
from codered.game import ROOT
from codered.routes import CHECKPOINTS, opening, SYS_FLAGS
from codered.battle import Battle
from codered.code_moves import CodeMoveHost, PayloadHost

MOVE_SCRATCH, MOVE_GROWL = 10, 45
SLOT = {MOVE_SCRATCH: 0, MOVE_GROWL: 1}
OUT = ROOT / 'build/sim/results'
SOUND_INFO = 0x03007FF0  # *(struct SoundInfo **): chans[] at +0x50, 0x40 each (count +0x18, wav +0x24)


def ref(name: str) -> dict:
    js = (f"import('./rules/index.mjs').then(r => {{ const p = r.PAYLOAD['{name}'], s = p.ref([42, 13, 140, 77]); "
          "console.log(JSON.stringify({ samples: s, character: p.character })) })")
    return json.loads(subprocess.run(['node', '-e', js], cwd=ROOT, capture_output=True, text=True, check=True).stdout)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    name = args[0] if args else 'growl'
    move = MOVE_GROWL if '--on-growl' in sys.argv else MOVE_SCRATCH
    OUT.mkdir(parents=True, exist_ok=True)
    cp = CHECKPOINTS / 'rival_battle_charmander.state'
    g = World()
    if not cp.exists():
        opening(g, 'CHARMANDER')
    g.load_state(cp.read_bytes())
    for i in range(8):
        g.set_flag(SYS_FLAGS + 0x20 + i)  # every badge: no doubt
    r = ref(name)
    payload = PayloadHost(g)
    def decide(req):
        if req['side'] == 0 and req['move'] == move:
            payload.deliver('sound', r['samples'])
        return ('hit', None)
    host = CodeMoveHost(g, decide); host.attach(); host.enable()
    b = Battle(g)
    for _ in range(200):
        if b.choosing_action(): break
        g.press('A', hold=2, after=6)
    b.act(0); g.run_until(b.choosing_move, limit=600); b.use_move(SLOT[move])
    g.audio = bytearray()
    si = g.u32(SOUND_INFO)
    counts = []
    for _ in range(150):
        g.run(1)
        a = payload.a
        if not a:
            continue
        for c in range(g.u8(si + 6)):  # maxChans
            ch = si + 0x50 + c * 0x40
            if g.u32(ch + 0x24) == a + 44 and g.u8(ch):  # this channel plays our wave, and is on
                counts.append(g.u32(ch + 0x18))
    pcm = array.array('h'); pcm.frombytes(bytes(g.audio)); g.audio = None
    mono = [(pcm[i] + pcm[i + 1]) // 2 for i in range(0, len(pcm) - 1, 2)]
    rate = round(len(mono) / 150 * 59.7275)
    with wave.open(str(OUT / f'payload-audio-{name}.wav'), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes(array.array('h', mono).tobytes())
    n = len(r['samples'])
    steps = [counts[i - 1] - counts[i] for i in range(1, len(counts)) if counts[i - 1] > counts[i]]
    hz = round(sum(steps) / len(steps) * 59.7275) if steps else 0
    played = (n - min(counts)) / n if counts else 0
    res = {'move': name, 'on': 'GROWL' if move == MOVE_GROWL else 'SCRATCH', 'samples': n, 'frames_on': len(counts),
           'playback_hz': hz, 'played_fraction': round(played, 3), 'mix_wav': str(OUT / f'payload-audio-{name}.wav')}
    ok = abs(hz - 8000) <= 240 and played >= 0.95
    (OUT / f'payload-audio-{name}.json').write_text(json.dumps(res, indent=1))
    print(json.dumps(res), 'OK' if ok else 'FAIL')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
