#!/usr/bin/env python3
"""Dress rehearsal on the LIVE site (2026-10-10): a brand-new friend, start to the gyms, with the real models.

Join with a one-use invite → recovery code → load a FireRed ROM → Oak's lab (starter card) → the first rival battle
→ the bedroom PC (PokÉEG) → an in-game save that must reach the cloud → each gym leader battle the simulator reached
(raw states from sim/rehearse.py). The player presses buttons like a person: FIGHT, then a move (it cycles through
its moves so every move, payloads included, gets written), A through the text. Every code move is timed from
"writing…" to its verdict. Console errors, failed requests and backend errors are collected.

  SITE=https://maxcembalest.com/pokemon-code-red INVITE=RED-XXXX-XXXX python3 player/tests/rehearsal_live.py
Writes build/rehearsal/live.json + screenshots (no ROM bytes, no states).
"""
import base64, json, os, secrets, time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'build/rehearsal'
SITE = os.environ.get('SITE', 'https://maxcembalest.com/pokemon-code-red')
INVITE = os.environ.get('INVITE')  # unset: a local dry run (SITE = the dev server, ?agents=mock, no account)
STATES = ROOT / 'build/sim/checkpoints'
GYMS = sorted((ROOT / 'build/sim/rehearsal').glob('gym-*.raw'))
SYM = {k: v['address'] for k, v in json.loads((ROOT / 'build/rom/rom.json').read_text())['symbols'].items()}
KEY = {'B': 0, 'START': 3, 'UP': 4, 'DOWN': 5, 'LEFT': 6, 'RIGHT': 7, 'A': 8}

report = {'site': SITE, 'steps': [], 'turns': [], 'console_errors': [], 'failed_requests': [], 'api_errors': [], 'notes': []}
t_start = time.time()


def step(name, ok, t0, **kw):
    report['steps'].append({'step': name, 'ok': bool(ok), 'seconds': round(time.time() - t0, 1), **kw})
    print(f"{'ok  ' if ok else 'FAIL'} {name} ({time.time() - t0:.1f}s) {kw if kw else ''}", flush=True)


MEM_JS = '''(() => {
  const M = () => EJS_emulator.gameManager.Module
  const at = a => { const iw = a >= 0x03000000, m = M(); return (iw ? m._ejs_cr_iwram() : m._ejs_cr_ewram()) + a - (iw ? 0x03000000 : 0x02000000) }
  window.__u8 = a => M().HEAPU8[at(a)]
  window.__u16 = a => M().HEAPU8[at(a)] | M().HEAPU8[at(a) + 1] << 8
  window.__u32 = a => (__u16(a) | __u16(a + 2) << 16) >>> 0
  window.__press = async (k, hold = 3, after = 10) => { const gm = EJS_emulator.gameManager; gm.simulateInput(0, k, 1); await new Promise(r => setTimeout(r, hold * 17)); gm.simulateInput(0, k, 0); await new Promise(r => setTimeout(r, after * 17)) }
  // Every code verdict, timed from "writing…" (one entry per pane state change).
  window.__turns = []; const last = new WeakMap()
  new MutationObserver(() => { for (const p of document.querySelectorAll(".code-red-code-pane")) {
    const s = p.dataset.state, was = last.get(p); if (s === was) continue; last.set(p, s)
    if (s === "writing") p.__t0 = performance.now()
    if (s === "hit" || s === "miss" || s === "vanilla") window.__turns.push({ side: p.dataset.side, state: s, ms: p.__t0 ? Math.round(performance.now() - p.__t0) : null,
      head: p.querySelector("header")?.textContent ?? "", foot: p.querySelector("footer")?.textContent ?? "", code: (p.querySelector("pre, code")?.textContent ?? "").slice(0, 400) })
  } }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true })
})()'''


def battle_state(page):
    cb2 = page.evaluate(f'__u32({SYM["gMain"] + 4})') & ~1
    if cb2 != SYM['BattleMainCB2'] & ~1:
        return 'none'
    ctrl = page.evaluate(f'__u32({SYM["gBattlerControllerFuncs"]})') & ~1
    if ctrl in (SYM['battle_controller_player.HandleInputChooseAction'] & ~1, SYM['battle_controller_oak_old_man.HandleInputChooseAction'] & ~1):
        return 'action'
    if ctrl in (SYM['battle_controller_player.HandleInputChooseMove'] & ~1, SYM['battle_controller_oak_old_man.OakOldManHandleInputChooseMove'] & ~1):
        return 'move'
    return 'busy'


def press(page, k, **kw):
    page.evaluate(f'__press({KEY[k]}, {kw.get("hold", 3)}, {kw.get("after", 10)})')


def play_battle(page, name, limit_s=900):
    """Press like a person until the battle ends: FIGHT, the next move in turn (cycling), A through text."""
    t0, n0, turn = time.time(), len(page.evaluate('__turns')), 0
    mons = SYM['gBattleMons']
    seen_battle = False
    while time.time() - t0 < limit_s:
        s = battle_state(page)
        if s == 'none':
            if seen_battle:
                break
            press(page, 'A'); continue
        seen_battle = True
        if s == 'action':
            press(page, 'A', after=20)
        elif s == 'move':
            moves = [page.evaluate(f'__u16({mons + 0x0C + 2 * i})') for i in range(4)]
            pp = [page.evaluate(f'__u8({mons + 0x24 + i})') for i in range(4)]
            usable = [i for i in range(4) if moves[i] and pp[i]]
            want = usable[turn % len(usable)] if usable else 0
            cur = page.evaluate(f'__u8({SYM["gMoveSelectionCursor"]})')
            if (cur & 1) != (want & 1): press(page, 'RIGHT' if want & 1 else 'LEFT')
            if (cur >> 1) != (want >> 1): press(page, 'DOWN' if want >> 1 else 'UP')
            press(page, 'A', after=20); turn += 1
        else:
            page.wait_for_timeout(250)
            press(page, 'A', after=6)
    turns = page.evaluate('__turns')[n0:]
    outcome = page.evaluate(f'__u8({SYM["gBattleOutcome"]})')
    page.screenshot(path=str(OUT / f'{name}-end.png'))
    return turns, {1: 'won', 2: 'lost', 3: 'drew', 4: 'ran'}.get(outcome, f'outcome {outcome}'), round(time.time() - t0)


def load_state(page, path: Path):
    page.evaluate('b64 => EJS_emulator.gameManager.loadState(Uint8Array.from(atob(b64), c => c.charCodeAt(0)))', base64.b64encode(path.read_bytes()).decode())
    page.wait_for_timeout(1500)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    username = 'rehearsal_' + secrets.token_hex(3)
    password = secrets.token_urlsafe(12)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={'width': 1280, 'height': 900})
        page.on('console', lambda m: report['console_errors'].append(m.text[:300]) if m.type == 'error' and 'invalid core option' not in m.text else None)
        page.on('pageerror', lambda e: report['console_errors'].append('pageerror: ' + str(e)[:300]))
        page.on('requestfailed', lambda r: report['failed_requests'].append(f'{r.method} {r.url[:120]} {r.failure}'))
        page.on('response', lambda r: report['api_errors'].append(f'{r.status} {r.request.method} {r.url[:120]}') if 'workers.dev' in r.url and r.status >= 400 else None)

        if not INVITE:
            page.goto(f'{SITE}?agents=mock'); page.wait_for_selector('[data-open]:not([hidden])', timeout=30000)
        else:
          t0 = time.time(); page.goto(f'{SITE}?invite={INVITE}', wait_until='domcontentloaded')
          ok = page.wait_for_selector('[data-join]:not([hidden])', timeout=60000) is not None
          page.screenshot(path=str(OUT / '01-join.png')); step('join form shows', ok, t0)
          t0 = time.time()
          page.fill('[data-name]', 'Rehearsal'); page.fill('[data-username]', username); page.fill('[data-password]', password)
          page.click('[data-join] button')
          page.wait_for_selector('[data-recovery]:not([hidden])', timeout=30000)
          page.screenshot(path=str(OUT / '02-recovery.png'))
          page.click('[data-recovery-ok]')
          ok = page.wait_for_selector('[data-open]:not([hidden])', timeout=30000) is not None
          page.screenshot(path=str(OUT / '03-rom-chooser.png')); step('join → recovery code → ROM chooser', ok, t0, username=username)

        t0 = time.time()
        page.locator('[data-file]').set_input_files(str(ROOT / 'local/baserom.gba'))
        page.wait_for_function('window.EJS_emulator?.started', timeout=180000)
        page.wait_for_timeout(3000)
        page.screenshot(path=str(OUT / '04-booted.png')); step('ROM loads, game boots', True, t0)
        page.evaluate(MEM_JS)

        # Oak's lab: the starter card.
        t0 = time.time(); load_state(page, STATES / 'lab_at_charmander.raw')
        for _ in range(20):
            if page.locator('[data-starter-card]').is_visible(): break
            press(page, 'A'); page.wait_for_timeout(600)
        ok = page.locator('[data-starter-card]').is_visible()
        page.screenshot(path=str(OUT / '05-starter-card.png')); step('starter card in Oak\'s lab', ok, t0)

        # First rival battle, real models.
        t0 = time.time(); load_state(page, STATES / 'rival_choose_action.raw')
        turns, outcome, secs = play_battle(page, '06-rival')
        report['turns'] += [{**t, 'battle': 'rival'} for t in turns]
        step('first rival battle', bool(turns), t0, outcome=outcome, code_turns=len(turns))

        # Bedroom PC: PokÉEG, then an in-game save that must reach the cloud.
        t0 = time.time(); load_state(page, STATES / 'bedroom_pc.raw')
        press(page, 'UP'); press(page, 'A', after=60); press(page, 'A', after=60)  # boot the PC → its menu
        press(page, 'DOWN'); press(page, 'DOWN'); press(page, 'A', after=120)  # PokÉEG
        page.wait_for_timeout(4000)
        page.screenshot(path=str(OUT / '07-pokeeg.png'))
        panel = page.locator('.code-red-eeg').is_visible()
        for _ in range(4): press(page, 'RIGHT', after=20)
        page.screenshot(path=str(OUT / '08-pokeeg-instinct.png'))
        for _ in range(6): press(page, 'B', after=30)
        step('PokÉEG from the bedroom PC', panel, t0, page_panel_followed=panel)

        t0 = time.time()
        before = None if not INVITE else page.evaluate('(async () => { const s = JSON.parse(localStorage.getItem("code-red-session") || "{}"); const r = await fetch("https://code-red-api.macembalest.workers.dev/v1/save", { headers: { authorization: "Bearer " + s.token } }); return (await r.json()).version })()')
        press(page, 'START', after=40)
        for _ in range(3): press(page, 'DOWN', after=8)  # POKéMON, BAG, <name>, SAVE (no POKéDEX yet)
        page.screenshot(path=str(OUT / '09-start-menu.png'))
        press(page, 'A', after=60); press(page, 'A', after=240); press(page, 'A', after=240)
        page.wait_for_timeout(25000)  # the page fingerprints SRAM every 10 s, then uploads
        after = None if not INVITE else page.evaluate('(async () => { const s = JSON.parse(localStorage.getItem("code-red-session") || "{}"); const r = await fetch("https://code-red-api.macembalest.workers.dev/v1/save", { headers: { authorization: "Bearer " + s.token } }); return (await r.json()).version })()')
        page.screenshot(path=str(OUT / '10-saved.png'))
        step('in-game save reaches the cloud', (after or 0) > (before or 0) if INVITE else True, t0, before=before, after=after)

        # Gym leaders the simulator reached.
        for gym in GYMS:
            t0 = time.time(); load_state(page, gym)
            turns, outcome, secs = play_battle(page, gym.stem, limit_s=1200)
            report['turns'] += [{**t, 'battle': gym.stem} for t in turns]
            step(f'{gym.stem} battle', bool(turns), t0, outcome=outcome, code_turns=len(turns))
        browser.close()

    ts = report['turns']
    mine = [t for t in ts if t['side'] == 'you']
    waits = sorted(t['ms'] for t in ts if t['ms'])
    report['summary'] = {'minutes': round((time.time() - t_start) / 60, 1), 'code_turns': len(ts), 'your_turns': len(mine),
                         'your_hits': sum(t['state'] == 'hit' for t in mine), 'vanilla': sum(t['state'] == 'vanilla' for t in ts),
                         'wait_median_s': round(waits[len(waits) // 2] / 1000, 1) if waits else None,
                         'wait_p90_s': round(waits[int(len(waits) * 0.9)] / 1000, 1) if waits else None,
                         'steps_failed': [s['step'] for s in report['steps'] if not s['ok']]}
    (OUT / 'live.json').write_text(json.dumps(report, indent=1))
    print(json.dumps(report['summary'], indent=1))


if __name__ == '__main__':
    try:
        main()
    finally:
        if not (OUT / 'live.json').exists():
            (OUT / 'live.json').write_text(json.dumps(report, indent=1))
