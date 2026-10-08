#!/usr/bin/env python3
"""Battle in Chromium: code moves (mock model writes both sides' code, the code panel streams it,
the ROM takes hit/miss) + the move-picking agent prototype (mock brain) + replay.

Starts from a simulator checkpoint (the sim and the browser run the same mGBA core,
so its save states load in the page): first rival battle, action menu.
Needs: make player, local/baserom.gba, scripts/serve_player.py on :8000, and
build/sim/checkpoints/rival_choose_action.raw (python3 sim/make_states.py).
  python3 player/tests/agent_battle.py
"""
import base64, json, os, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'build/agent'
STATE = ROOT / 'build/sim/checkpoints/rival_choose_action.raw'


def battle(p, url, records=None):
    """One browser run from the rival-battle state. Returns result dict (+ the page's agent records)."""
    outcome_addr = json.loads((ROOT / 'build/rom/rom.json').read_text())['symbols']['gBattleOutcome']['address']
    browser = p.chromium.launch(headless=True, args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    page = browser.new_page()
    errors, external, said = [], [], []
    page.on('pageerror', lambda e: 'Wake Lock' in str(e) or errors.append(str(e)))
    page.on('request', lambda r: r.url.startswith(('http://127.0.0.1', 'blob:', 'data:')) or external.append(r.url))
    if records is not None:
        page.route('**/records.json', lambda route: route.fulfill(status=200, content_type='application/json', body=json.dumps(records)))
    page.goto(url)
    page.wait_for_selector('[data-open]:not([hidden])', timeout=30000)
    page.locator('[data-file]').set_input_files(str(ROOT / 'local/baserom.gba'))
    page.wait_for_function('window.EJS_emulator?.started', timeout=90000)
    page.wait_for_timeout(1500)
    assert page.locator('[data-agent]').is_visible(), 'Agent toggle should show with ?agents='
    page.evaluate('b64 => EJS_emulator.gameManager.loadState(Uint8Array.from(atob(b64), c => c.charCodeAt(0)))', base64.b64encode(STATE.read_bytes()).decode())
    page.wait_for_timeout(1000)
    # Every verdict the code panel shows: "<side>: <head> | <foot>".
    page.evaluate('''window.__verdicts = []; new MutationObserver(() => { for (const p of document.querySelectorAll(".code-red-code-pane")) { const s = p.dataset.state; if (s === "hit" || s === "miss" || s === "vanilla") { const v = p.dataset.side + ": " + p.querySelector("header").textContent + " | " + p.querySelector("footer").textContent; if (!window.__verdicts.includes(v)) window.__verdicts.push(v) } } }).observe(document.querySelector("[data-stage]"), { subtree: true, childList: true, characterData: true, attributes: true })''')
    # Agents mode starts with the agent in control (button pressed).
    assert page.get_attribute('[data-agent]', 'aria-pressed') == 'true'
    page.wait_for_function('document.querySelector("[data-agent-box]")?.dataset.turns >= "1"', timeout=60000)
    page.wait_for_timeout(300)
    page.screenshot(path=str(OUT / ('replay.png' if records is not None else 'thinking.png')))
    first = page.text_content('[data-agent-box]')
    print('first turn:', first, flush=True)
    assert 'CHARMANDER' in first and '▶' in first, first
    if records is None:
        page.wait_for_function('window.__verdicts.some(v => v.startsWith("you:")) && window.__verdicts.some(v => v.startsWith("foe:"))', timeout=90000)
        page.screenshot(path=str(OUT / 'code-panel.png'), full_page=True)
        assert page.locator('[data-code]').is_visible(), 'Code toggle shows'
    page.evaluate('gm = EJS_emulator.gameManager; gm.functions.setFastForwardRatio(10); gm.functions.toggleFastForward(1)')
    done = '''a => { const m = EJS_emulator.gameManager.Module; return new DataView(m.HEAPU8.buffer, m._ejs_cr_ewram()).getUint8(a - 0x02000000) !== 0 }'''
    for i in range(24):
        if page.evaluate(done, outcome_addr):
            break
        page.wait_for_timeout(10000)
        print('waiting', i, page.get_attribute('[data-agent-box]', 'data-turns'), flush=True)
    else:
        raise AssertionError('battle did not finish')
    outcome = page.evaluate(done.replace('!== 0', ''), outcome_addr)
    turns = int(page.get_attribute('[data-agent-box]', 'data-turns') or 0)
    recs = page.evaluate('window.CodeRed.agentRecords()')
    verdicts = page.evaluate('window.__verdicts')
    print('code verdicts:', verdicts, flush=True)
    assert any(v.startswith('you: CHARMANDER') and 'a plain list' in v for v in verdicts), verdicts  # first battle = tutorial
    assert any(v.startswith('foe: Foe SQUIRTLE') for v in verdicts), verdicts
    assert any("code hit!" in v for v in verdicts), verdicts
    page.locator('canvas').screenshot(path=str(OUT / 'after.png'))
    browser.close()
    result = {'outcome': {1: 'won', 2: 'lost'}.get(outcome, outcome), 'turns': turns, 'errors': errors, 'external': external}
    print(json.dumps(result), flush=True)
    assert turns >= 2 and outcome in (1, 2), result
    if errors or external:
        sys.exit('FAIL: page errors or external requests')
    return result, recs


def starter_card(p):
    """Oak's lab: offered CHARMANDER → the agent card shows its scripts."""
    browser = p.chromium.launch(headless=True, args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    page = browser.new_page()
    page.goto('http://127.0.0.1:8000/?agents=mock')
    page.wait_for_selector('[data-open]:not([hidden])', timeout=30000)
    page.locator('[data-file]').set_input_files(str(ROOT / 'local/baserom.gba'))
    page.wait_for_function('window.EJS_emulator?.started', timeout=90000)
    page.wait_for_timeout(1500)
    lab = ROOT / 'build/sim/checkpoints/lab_at_charmander.raw'
    page.evaluate('b64 => EJS_emulator.gameManager.loadState(Uint8Array.from(atob(b64), c => c.charCodeAt(0)))', base64.b64encode(lab.read_bytes()).decode())
    page.wait_for_timeout(500)
    for _ in range(20):
        if page.locator('[data-starter-card]').is_visible():
            break
        page.evaluate('(async () => { const gm = EJS_emulator.gameManager; gm.simulateInput(0, 8, 1); await new Promise(r => setTimeout(r, 80)); gm.simulateInput(0, 8, 0) })()')
        page.wait_for_timeout(700)
    page.wait_for_selector('[data-starter-card]:not([hidden])', timeout=5000)
    page.wait_for_timeout(500)
    page.locator('[data-game]').screenshot(path=str(OUT / 'starter-card.png'))
    text = page.text_content('[data-starter-card]')
    print('starter card:', text.replace('\n', ' ')[:200], flush=True)
    assert 'CHARMANDER' in text and 'SLICE' in text and 'ERRORMSG' in text and 'function slice(data)' in text, text
    browser.close()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        starter_card(p)
        live, records = battle(p, 'http://127.0.0.1:8000/?agents=mock')
        assert len(records) == live['turns'] and all(r['brain'] == 'mock' for r in records), records
        # Replay: same situations → recorded decisions (tagged so we can see they came from the recording).
        for i, r in enumerate(records):
            r['decision']['thought'] = f'REPLAYED {i}'
        (OUT / 'records.json').write_text(json.dumps(records, indent=2))
        again, replayed = battle(p, 'http://127.0.0.1:8000/?agents=replay&records=records.json', records)
        # The browser isn't frame-locked (agent think time varies), so the game's RNG can
        # diverge after the first turn. Contract: a situation seen in the recording gets the
        # recorded decision; a new one goes to the fallback brain.
        recorded = {r['key']: r['decision'] for r in records}
        hits = [r for r in replayed if r['key'] in recorded]
        assert replayed[0]['key'] == records[0]['key'], 'same start state → same first observation'
        assert all(r['decision'] == recorded[r['key']] for r in hits), (replayed, records)
        assert all(r['decision']['thought'].startswith('REPLAYED') == (r['key'] in recorded) for r in replayed), replayed
        print(f'replay: {len(hits)}/{len(replayed)} turns matched the recording', flush=True)
    (OUT / 'result.json').write_text(json.dumps({'live': live, 'replay': again}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except BaseException as problem:
        if os.environ.get('GITHUB_ACTIONS') and not (isinstance(problem, SystemExit) and problem.code in (0, None)):
            print(f'::error title=agent battle::{type(problem).__name__}: {str(problem)[:800]}'.replace('\n', ' '), flush=True)
        raise
