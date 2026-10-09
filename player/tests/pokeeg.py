#!/usr/bin/env python3
"""The PokÉEG in Chromium: every owned Pokémon read from RAM (party + boxes), its system, readers,
hot memory pinned from the page (costs bytes), and the code it wrote in the last battle.

Starts from the rival-battle checkpoint (CHARMANDER in the party, mock model writes code).
Needs: make player, local/baserom.gba, scripts/serve_player.py on :8000,
build/sim/checkpoints/rival_choose_action.raw (python3 sim/make_states.py).
  python3 player/tests/pokeeg.py
"""
import base64, os, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'build/pokeeg'
STATE = ROOT / 'build/sim/checkpoints/rival_choose_action.raw'


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        page = browser.new_page(viewport={'width': 1200, 'height': 900})
        errors = []
        page.on('pageerror', lambda e: 'Wake Lock' in str(e) or errors.append(str(e)))
        page.goto('http://127.0.0.1:8000/?agents=mock')
        page.wait_for_selector('[data-open]:not([hidden])', timeout=30000)
        page.locator('[data-file]').set_input_files(str(ROOT / 'local/baserom.gba'))
        page.wait_for_function('window.EJS_emulator?.started', timeout=90000)
        page.wait_for_timeout(1500)
        page.evaluate('b64 => EJS_emulator.gameManager.loadState(Uint8Array.from(atob(b64), c => c.charCodeAt(0)))', base64.b64encode(STATE.read_bytes()).decode())
        page.wait_for_timeout(1000)

        # 1. The toolbar button opens it; the party shows CHARMANDER read from RAM.
        page.click('[data-eeg]')
        page.wait_for_selector('.code-red-eeg:not([hidden])', timeout=5000)
        page.wait_for_function('document.querySelector(".code-red-eeg-list [data-pid]")', timeout=10000)
        owned = page.evaluate('window.CodeRed.owned()')
        print('owned:', [(m['where'], m['name'], m['level'], m['types']) for m in owned], flush=True)
        assert owned and owned[0]['name'] == 'CHARMANDER' and owned[0]['types'] == ['FIRE'], owned
        mind = page.text_content('.code-red-eeg-mind')
        assert 'FIRE system' in mind and 'System 2' in mind and 'byte budget' in mind, mind[:300]
        print('mind:', ' '.join(mind.split())[:240], flush=True)

        # 2. Pin hot memory: the cost shows in bytes and the note is kept in the mind store.
        page.fill('.code-red-eeg [data-hot]', 'return a plain number')
        assert '21 chars = 21 bytes' in page.text_content('.code-red-eeg-hot small')
        page.click('.code-red-eeg [data-save-hot]')
        pid = owned[0]['personality']
        assert page.evaluate(f'window.CodeRed.hot({pid})') == 'return a plain number'
        page.screenshot(path=str(OUT / 'pokeeg.png'), full_page=True)
        print('hot memory ok', flush=True)

        # 3. A battle turn (mock model) lands in its recent code.
        page.evaluate('gm = EJS_emulator.gameManager; gm.functions.setFastForwardRatio(10); gm.functions.toggleFastForward(1)')
        page.wait_for_function(f'window.CodeRed.owned() && (JSON.parse(localStorage.getItem("code-red-code-memory-v1") || "{{}}").recent || {{}})["{pid}"]?.length >= 1', timeout=120000)
        page.evaluate('gm.functions.toggleFastForward(0)')
        page.wait_for_timeout(2500)  # the panel refreshes every 2 s
        page.click('.code-red-eeg-list [data-pid]')
        page.wait_for_selector('.code-red-eeg-turn', timeout=5000)
        turn = page.text_content('.code-red-eeg-turn summary')
        print('recent:', ' '.join(turn.split()), flush=True)
        page.screenshot(path=str(OUT / 'pokeeg-after-battle.png'), full_page=True)
        browser.close()
    if errors:
        sys.exit('page errors: ' + '; '.join(errors))
    print('pokeeg ok')


if __name__ == '__main__':
    try:
        main()
    except BaseException as problem:
        if os.environ.get('GITHUB_ACTIONS') and not (isinstance(problem, SystemExit) and problem.code in (0, None)):
            print(f'::error title=pokeeg e2e::{type(problem).__name__}: {str(problem)[:800]}'.replace('\n', ' '), flush=True)
        raise
