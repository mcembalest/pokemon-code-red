#!/usr/bin/env python3
"""Optional browser verification. Requires playwright + Chromium and make serve."""
import json
from pathlib import Path
import re
import shutil
from playwright.sync_api import sync_playwright

OUT = Path(__file__).resolve().parents[1] / 'build'
with sync_playwright() as playwright:
    executable = shutil.which('chromium') or shutil.which('chromium-browser')
    browser = playwright.chromium.launch(executable_path=executable, headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    requests = []
    page.on('request', lambda request: requests.append(request.url))
    page.goto('http://127.0.0.1:8000')
    page.wait_for_function('!document.querySelector("#play").disabled')
    page.locator('#play').tap()
    page.wait_for_function('window.EJS_emulator && window.EJS_emulator.gameManager', timeout=60000)
    page.wait_for_timeout(12000)
    buttons = page.locator('.ejs_virtualGamepad_button')
    start = buttons.filter(has_text=re.compile('^Start$'))
    a = buttons.filter(has_text=re.compile('^A$'))
    assert start.is_visible() and a.is_visible()
    page.evaluate('window._inputs=[];const gm=EJS_emulator.gameManager;const original=gm.simulateInput.bind(gm);gm.simulateInput=(...args)=>{window._inputs.push(args);return original(...args)}')
    start.tap()
    page.wait_for_timeout(1000)
    for i in range(16):
        a.tap()
        page.wait_for_timeout(700)
        if i == 7: page.locator('canvas').screenshot(path=str(OUT / 'browser-help.png'))
    page.locator('canvas').screenshot(path=str(OUT / 'browser-intro.png'))
    inputs = page.evaluate('window._inputs')
    assert [0, 3, 1] in inputs and [0, 3, 0] in inputs, 'Start touch did not reach core'
    assert [0, 8, 1] in inputs and [0, 8, 0] in inputs, 'A touch did not reach core'
    external = [url for url in requests if not url.startswith(('http://127.0.0.1:8000/', 'blob:', 'data:'))]
    assert external == [], external
    result = {'mobile_viewport': '390x844', 'start_touch_core_input': True, 'a_touch_core_input': True,
              'external_requests': external, 'visible_touch_buttons': buttons.all_text_contents()}
    (OUT / 'browser-smoke.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))
    browser.close()
