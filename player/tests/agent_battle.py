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


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    outcome_addr = json.loads((ROOT / 'build/rom/rom.json').read_text())['symbols']['gBattleOutcome']['address']
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        page = browser.new_page()
        errors, external = [], []
        page.on('pageerror', lambda e: 'Wake Lock' in str(e) or errors.append(str(e)))
        page.on('request', lambda r: r.url.startswith(('http://127.0.0.1', 'blob:', 'data:')) or external.append(r.url))
        page.goto('http://127.0.0.1:8000/?agents=mock')
        page.wait_for_selector('[data-open]:not([hidden])', timeout=30000)
        page.locator('[data-file]').set_input_files(str(ROOT / 'local/baserom.gba'))
        page.wait_for_function('window.EJS_emulator?.started', timeout=90000)
        page.wait_for_timeout(1500)
        assert page.locator('[data-agent]').is_visible(), 'Agent toggle should show with ?agents='
        page.evaluate('b64 => EJS_emulator.gameManager.loadState(Uint8Array.from(atob(b64), c => c.charCodeAt(0)))', base64.b64encode(STATE.read_bytes()).decode())
        page.wait_for_timeout(1000)
        page.locator('canvas').screenshot(path=str(OUT / 'before.png'))
        page.click('[data-agent]')
        assert page.get_attribute('[data-agent]', 'aria-pressed') == 'true'
        page.wait_for_function('document.querySelector("[data-agent-box]")?.dataset.turns >= "1"', timeout=60000)
        page.wait_for_timeout(300)
        page.screenshot(path=str(OUT / 'thinking.png'))
        first = page.text_content('[data-agent-box]')
        print('first turn:', first, flush=True)
        assert 'CHARMANDER' in first and '▶' in first, first
        # Let it fight to the end (fast-forward); battle messages auto-advance.
        page.evaluate('gm = EJS_emulator.gameManager; gm.functions.setFastForwardRatio(10); gm.functions.toggleFastForward(1)')
        done = '''a => { const m = EJS_emulator.gameManager.Module; return new DataView(m.HEAPU8.buffer, m._ejs_cr_ewram()).getUint8(a - 0x02000000) !== 0 }'''
        for i in range(24):
            if page.evaluate(done, outcome_addr):
                break
            page.wait_for_timeout(10000)
            page.locator('canvas').screenshot(path=str(OUT / f'progress-{i:02d}.png'))
            print('waiting', i, page.get_attribute('[data-agent-box]', 'data-turns'), page.evaluate('EJS_emulator.gameManager.functions.getFrameNum()'), flush=True)
        else:
            raise AssertionError('battle did not finish')
        outcome = page.evaluate('''a => { const m = EJS_emulator.gameManager.Module; return new DataView(m.HEAPU8.buffer, m._ejs_cr_ewram()).getUint8(a - 0x02000000) }''', outcome_addr)
        turns = int(page.get_attribute('[data-agent-box]', 'data-turns') or 0)
        page.locator('canvas').screenshot(path=str(OUT / 'after.png'))
        browser.close()
    result = {'outcome': {1: 'won', 2: 'lost'}.get(outcome, outcome), 'turns': turns, 'errors': errors, 'external': external}
    print(json.dumps(result), flush=True)
    (OUT / 'result.json').write_text(json.dumps(result, indent=2))
    assert turns >= 2 and outcome in (1, 2), result
    if errors or external:
        sys.exit('FAIL: page errors or external requests')


if __name__ == '__main__':
    try:
        main()
    except BaseException as problem:
        if os.environ.get('GITHUB_ACTIONS') and not (isinstance(problem, SystemExit) and problem.code in (0, None)):
            print(f'::error title=agent battle::{type(problem).__name__}: {str(problem)[:800]}'.replace('\n', ' '), flush=True)
        raise
