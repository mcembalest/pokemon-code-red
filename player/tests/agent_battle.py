#!/usr/bin/env python3
"""Battle-agent prototype in Chromium: the starter picks its own moves (mock brain).

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
    page.click('[data-agent]')
    assert page.get_attribute('[data-agent]', 'aria-pressed') == 'true'
    page.wait_for_function('document.querySelector("[data-agent-box]")?.dataset.turns >= "1"', timeout=60000)
    page.wait_for_timeout(300)
    page.screenshot(path=str(OUT / ('replay.png' if records is not None else 'thinking.png')))
    first = page.text_content('[data-agent-box]')
    print('first turn:', first, flush=True)
    assert 'CHARMANDER' in first and '▶' in first, first
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
    page.locator('canvas').screenshot(path=str(OUT / 'after.png'))
    browser.close()
    result = {'outcome': {1: 'won', 2: 'lost'}.get(outcome, outcome), 'turns': turns, 'errors': errors, 'external': external}
    print(json.dumps(result), flush=True)
    assert turns >= 2 and outcome in (1, 2), result
    if errors or external:
        sys.exit('FAIL: page errors or external requests')
    return result, recs


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
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
