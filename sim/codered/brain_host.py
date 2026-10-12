"""Code moves in the simulator with the page's own brain (sim/brain.ts: CodeBattle + the real models).

Every code-move request the ROM makes is sent to a Node process that writes the code with the real model, runs it,
judges it and (for a payload move) hands back the bytes; the emulator waits while it thinks, like the game waits for
the browser. Records every turn to `log` (a JSONL path) for the rehearsal report.
"""
import json, subprocess, tempfile, time
from pathlib import Path
from .code_moves import CodeMoveHost, PayloadHost
from .game import ROOT

SYS_FLAGS = 0x800
BADGE_NAMES = ['BOULDER', 'CASCADE', 'THUNDER', 'RAINBOW', 'SOUL', 'MARSH', 'VOLCANO', 'EARTH']


class BrainHost:
    def __init__(self, g, log: Path | None = None, mock: bool = False, env: dict | None = None):
        import os
        self.g, self.log = g, log
        e = {**os.environ, **(env or {})}
        if mock:
            e['BRAIN_MOCK'] = '1'
        self.err = tempfile.TemporaryFile('w+')  # the brain's stderr, shown when it dies
        self.proc = subprocess.Popen(['node', '--experimental-strip-types', '--no-warnings', str(ROOT / 'sim/brain.ts'), str(ROOT / 'build/code-red.gba'), str(ROOT / 'build/rom/rom.json')],
                                     cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.err, text=True, env=e)
        self.payload = PayloadHost(g)
        self.moves = CodeMoveHost(g, self.decide, delay=2)
        self.turns: list[dict] = []
        g.code_stats = {}  # (move name, foe type ids) -> (hits, tries), for the move chooser
        self.memories: list[dict] = []
        self._in_battle = False
        if log:
            log.parent.mkdir(parents=True, exist_ok=True)
            log.write_text('')

    def _ask(self, msg: dict) -> dict:
        try:
            self.proc.stdin.write(json.dumps(msg) + '\n'); self.proc.stdin.flush()
            line = self.proc.stdout.readline()
        except (BrokenPipeError, OSError):
            line = ''
        if not line:
            raise RuntimeError(f'the code brain (sim/brain.ts) died: {self.stderr_tail()}')
        return json.loads(line)

    def stderr_tail(self, n: int = 1500) -> str:
        try:
            self.err.seek(0)
            return self.err.read()[-n:].strip() or '(no stderr)'
        except Exception:
            return '(stderr unavailable)'

    def badges(self) -> list[str]:
        return [n for i, n in enumerate(BADGE_NAMES) if self.g.flag(SYS_FLAGS + 0x20 + i)]

    def decide(self, r: dict):
        req = {'id': r['id'], 'epoch': 1, 'move': r['move'], 'attackerSide': r['side'], 'attackerLevel': r['level'],
               'attackerSpecies': r['attacker'], 'targetSpecies': r['target'], 'attackerPersonality': r['attacker_pid'],
               'targetPersonality': r['target_pid'], 'targetLevel': r['target_level'], 'targetTypes': list(r['target_types']),
               'battleTypeFlags': r['battle_flags'], 'trainerId': r['trainer'], 'attackerStages': r['stages'],
               'trainerClass': r['class'], 'calledSlot': r.get('called_slot', 0)}
        called = None
        if req['calledSlot']:
            base = self.g.sym('gBattleMons')  # battler 0's moves[slot]
            called = self.g.u16(base + 0x0C + 2 * (req['calledSlot'] - 1))
        t = time.time()
        res = self._ask({'op': 'turn', 'req': req, 'badges': self.badges(), 'called': str(called) if called else None})
        wall = round(time.time() - t, 2)
        if res.get('payload') and self.payload.a:
            p = res['payload']
            self.payload.deliver(p['kind'], p['bytes'], p.get('palette'))
        rec = {**(res.get('record') or {}), 'verdict': res['verdict'], 'reason': res.get('reason') if res['verdict'] == 'miss' else None, 'wall': wall,
               'usage': res.get('usage'), 'map': self.g.map(), 'frame': self.g.frame, 'payload_kind': (res.get('payload') or {}).get('kind'),
               'level': r['level'], 'side': r['side'], 'trainer': r['trainer'], 'class': r['class'], 'doubted_slot': req['calledSlot']}
        self.turns.append(rec)
        if r['side'] == 0 and res['verdict'] in ('hit', 'miss'):  # the move chooser learns what lands (battle.best_move)
            key = (rec.get('move'), tuple(sorted(set(r['target_types']))))  # the record's move name = rules.moves[id].name
            h, n = self.g.code_stats.get(key, (0, 0))
            self.g.code_stats[key] = (h + (res['verdict'] == 'hit'), n + 1)
        if self.log:
            with self.log.open('a') as f:
                f.write(json.dumps(rec) + '\n')
        return res['verdict'], res.get('reason') or 'crashed'

    def service(self) -> None:
        if self.g.frame % 30 == 0 and self.g.u8(self.moves.a + 7) != 1:
            self.moves.enable()  # the game clears RAM at boot and on a reset: re-enable, like the page's poll does
        self.moves.service()
        now = self.g.in_battle()
        if self._in_battle and not now:
            res = self._ask({'op': 'battle_over'})  # your Pokémon consolidate their memory (model calls) before play goes on
            for m in res.get('remembered') or []:
                rec = {**m, 'side': 'remember', 'map': self.g.map(), 'frame': self.g.frame, 'usage': res.get('usage') if m is res['remembered'][0] else None}
                self.memories.append(rec)
                if self.log:
                    with self.log.with_name('memory.jsonl').open('a') as f:
                        f.write(json.dumps(rec) + '\n')
        self._in_battle = now

    def attach(self) -> None:
        g, run = self.g, self.g.run
        self.moves.enable()
        def stepped(frames: int = 1, *buttons: str) -> None:
            for _ in range(frames):
                run(1, *buttons)
                self.service()
        g.run = stepped

    def close(self) -> None:
        try:
            self.proc.stdin.close(); self.proc.wait(timeout=10)
        except Exception:
            self.proc.kill()
        if self.proc.returncode:
            print(f'the code brain exited {self.proc.returncode}: {self.stderr_tail()}', flush=True)
