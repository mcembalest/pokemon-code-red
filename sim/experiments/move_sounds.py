#!/usr/bin/env python3
"""Listen to the sound moves the way a player hears them (owner, 2026-10-13: "cool and synthy, and at the same time
sound like the old Pokémon moves"). For each sound move — GROWL (ERROR), SONIC BOOM (BUZZ), SUPERSONIC (FEEDBACK),
SING (DIM) — put it in the lead's first slot in the first rival battle, use it, and record the game's audio with the
battle music paused:
  orig-<move>.wav   the move as FireRed plays it (the code service answers "vanilla": the original animation and sound)
  code-<move>.wav   the move with its code hit and the payload delivered (what Code Red plays)
Files land in build/sim/results/sounds/, with features.json (pitch contour per 40 ms window, duration, loudness).

  python3 sim/experiments/move_sounds.py [growl buzz ring lullaby] [--orig-only] [--species BULBASAUR] [--voice PIKACHU] [--check]
--voice: whose voice the code sings in (the reference for that species; default the lead's). --check (CI): each code
recording must differ from FireRed's and its sound must start when FireRed's does (the animation plays it, not the
text box), within 50 ms; for SING the notes must be FireRed's (the same pitches, within 3%).
"""
import array, json, subprocess, sys, wave
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from codered import World
from codered.game import ROOT
from codered.routes import CHECKPOINTS, opening, SYS_FLAGS
from codered.battle import Battle
from codered.code_moves import CodeMoveHost, PayloadHost

MOVES = {'growl': ('GROWL', 45), 'buzz': ('SONIC BOOM', 49), 'ring': ('SUPERSONIC', 48), 'lullaby': ('SING', 47)}
OUT = ROOT / 'build/sim/results/sounds'
PAUSE = 0x80000000
KIND = {'buzz': 'voice', 'ring': 'voice', 'lullaby': 'voice'}  # rules/payload.mjs: these payloads are an instrument
FRAMES = 360  # 6 s: the text, the animation and its sound


def ref(name: str, species: str) -> list[int]:
    js = (f"import('./rules/index.mjs').then(r => {{ const p = r.PAYLOAD['{name}']; const f = r.voicedRef(p, '{species}'); "
          "console.log(JSON.stringify(r.payloadBytes(p, f([42, 13, 140, 77])))) })")
    return json.loads(subprocess.run(['node', '-e', js], cwd=ROOT, capture_output=True, text=True, check=True).stdout)


_world: dict = {}


def world(species: str):
    """One emulator per process (libretro cores are process-global): one World, one code-move host, reused."""
    if not _world:
        g = World()
        cp = CHECKPOINTS / f'rival_battle_{species.lower()}.state'
        if not cp.exists():
            opening(g, species)
        payload = PayloadHost(g)
        _world.update(g=g, cp=cp.read_bytes(), payload=payload, decide=None)
        host = CodeMoveHost(g, lambda req: _world['decide'](req)); host.attach(); host.enable()
        _world['host'] = host
    return _world


def record(name: str, code: bool, species: str, seed: int = 0, voice: str | None = None) -> tuple[list[int], int]:
    label, move = MOVES[name]
    w = world(species)
    g, payload = w['g'], w['payload']
    g.load_state(w['cp'])
    w['host'].enable(); w['host']._answered.clear(); w['host']._due = None  # a reloaded state asks the same request id again
    for i in range(8):
        g.set_flag(SYS_FLAGS + 0x20 + i)  # every badge: no doubt, it uses the move we pick
    g.set_party_move(0, 0, move, 20)
    if seed:
        g.w32(g.sym('gRngValue'), seed * 2654435761)  # SING and SUPERSONIC hit 55%: another roll
    samples = ref(name, voice or species) if code else None
    def decide(req):
        w.setdefault('log', []).append((req['side'], req['move']))
        if req['side'] != 0:
            return ('vanilla', None)
        if code and req['move'] == move:
            payload.deliver(KIND.get(name, 'sound'), samples)
            return ('hit', None)
        return ('vanilla', None)
    w['decide'] = decide
    b = Battle(g)
    for _ in range(200):
        if b.choosing_action(): break
        g.press('A', hold=2, after=6)
    bgm = g.sym('gMPlayInfo_BGM')
    hm = g.sym('gHitMarker'); g.w32(hm, g.u32(hm) & ~(1 << 7))  # battle scene ON (the sim plays with it off): animations and their sounds
    g.w16(g.sym('gBattleMons') + 6, 999)  # our Pokémon moves first: its sound is the first one after the menu
    b.act(0); g.run_until(b.choosing_move, limit=600)
    g.w16(bgm + 36, 1); g.w16(bgm + 38, 1); g.w16(bgm + 40, 4)  # fadeOI/OC/OV: a one-frame fade-out stops every music track
    g.run(2)
    g.w32(bgm + 4, g.u32(bgm + 4) | PAUSE)
    b.use_move(0)
    g.audio = bytearray()
    for _ in range(FRAMES):
        g.w32(bgm + 4, g.u32(bgm + 4) | PAUSE)  # keep the music paused (the battle may resume it)
        g.run(1)
    pcm = array.array('h'); pcm.frombytes(bytes(g.audio)); g.audio = None
    mono = [(pcm[i] + pcm[i + 1]) // 2 for i in range(0, len(pcm) - 1, 2)]
    rate = round(len(mono) / FRAMES * 59.7275)
    dc = sorted(mono)[len(mono) // 2]  # the mixer idles at a DC offset (768 with the music stopped): center on it
    return [x - dc for x in mono], rate


def trim(mono: list[int], rate: int) -> list[int]:
    """Cut the silence before and after (the text box is silent with the music paused)."""
    loud = [i for i, x in enumerate(mono) if abs(x) > 600]
    if not loud:
        return mono
    return mono[max(0, loud[0] - rate // 50): min(len(mono), loud[-1] + rate // 20)]


def features(mono: list[int], rate: int) -> dict:
    win = rate // 25
    out = []
    for s in range(0, len(mono) - win, win):
        w = mono[s:s + win]
        rms = (sum(x * x for x in w) / win) ** 0.5
        side, cross = 0, 0
        for x in w:
            now = 1 if x > 400 else -1 if x < -400 else side
            if side and now != side: cross += 1
            side = now
        out.append({'ms': round(1000 * s / rate), 'hz': round(cross / 2 * rate / win), 'rms': round(rms)})
    return {'seconds': round(len(mono) / rate, 2), 'windows': out}


def save(path: Path, mono: list[int], rate: int) -> None:
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes(array.array('h', mono).tobytes())


def onset(mono: list[int], rate: int) -> float:
    """When the move's sound starts: the first loud sample after the menu's own blip (the first 0.3 s)."""
    skip = int(rate * 0.3)
    return next((i / rate for i, x in enumerate(mono[skip:], skip) if abs(x) > 1500), 0.0)


def pitches(mono: list[int], rate: int, spans) -> list[float]:
    import numpy as np
    out = []
    for a, b in spans:
        x = np.array(mono[int(a * rate):int(b * rate)], float)
        X = np.abs(np.fft.rfft((x - x.mean()) * np.hanning(len(x)))); fr = np.fft.rfftfreq(len(x), 1 / rate)
        m = (fr > 100) & (fr < 2000); out.append(float(fr[m][np.argmax(X[m])]))
    return out


def check(rec: dict, rate: int) -> list[str]:
    errors = []
    for name in {k.split('-', 1)[1] for k in rec}:
        o, c = rec.get(f'orig-{name}'), rec.get(f'code-{name}')
        if o is None or c is None:
            continue
        if o == c:
            errors.append(f'{name}: the code version sounds exactly like FireRed (the payload never played)')
        to, tc = onset(o, rate), onset(c, rate)
        if abs(to - tc) > 0.05:
            errors.append(f'{name}: starts at {tc:.2f} s, FireRed at {to:.2f} s (it should ride the animation)')
        if name == 'lullaby':
            spans = [(to + 0.2, to + 0.5), (to + 1.4, to + 1.7), (to + 3.1, to + 3.4)]
            po, pc = pitches(o, rate, spans), pitches(c, rate, spans)
            if any(abs(a / b - 1) > 0.03 for a, b in zip(po, pc)):
                errors.append(f'lullaby: notes {[round(x) for x in pc]} Hz, FireRed sings {[round(x) for x in po]}')
    return errors


def main():
    names = [a for a in sys.argv[1:] if not a.startswith('--') and a in MOVES] or list(MOVES)
    species = sys.argv[sys.argv.index('--species') + 1] if '--species' in sys.argv else 'BULBASAUR'
    voice = sys.argv[sys.argv.index('--voice') + 1] if '--voice' in sys.argv else species
    rec, rate = {}, 0
    OUT.mkdir(parents=True, exist_ok=True)
    feats = json.loads((OUT / 'features.json').read_text()) if (OUT / 'features.json').exists() else {}
    for name in names:
        for code in ([False] if '--orig-only' in sys.argv else [False, True]):
            for seed in range(12):  # a miss has no animation and no sound: roll again
                raw, rate = record(name, code, species, seed, voice)
                mono = trim(raw, rate)
                if len(mono) > rate * 0.6:
                    break
            tag = f"{'code' if code else 'orig'}-{name}"
            rec[tag] = raw
            if code and voice != species:
                tag += f'-{voice.lower()}'
            save(OUT / f'{tag}.wav', mono, rate)
            feats[tag] = features(mono, rate)
            print(tag, feats[tag]['seconds'], 's', flush=True)
    (OUT / 'features.json').write_text(json.dumps(feats, indent=1))
    if '--check' in sys.argv:
        errors = check(rec, rate)
        print('\n'.join(errors) or 'every sound move rides its own animation, in its own voice')
        sys.exit(1 if errors else 0)


if __name__ == '__main__':
    main()
