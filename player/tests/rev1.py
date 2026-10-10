#!/usr/bin/env python3
"""A player who brings FireRed v1.1 (Rev 1) instead of v1.0 gets the same Code Red build (2026-10-10).

  python3 player/tests/rev1.py      (needs local/baserom-rev1.gba, make player, a server on :8000)
"""
import hashlib, json, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
REV1 = ROOT / 'local/baserom-rev1.gba'
assert hashlib.sha1(REV1.read_bytes()).hexdigest() == 'dd5945db9b930750cb39d00c84da8571feebf417', 'local/baserom-rev1.gba is not FireRed v1.1'
rom = json.loads((ROOT / 'player/dist/rom/rom.json').read_text())
assert any(b['sha1'] == 'dd5945db9b930750cb39d00c84da8571feebf417' for b in rom.get('bases', [])), 'this build has no Rev 1 patch'
with sync_playwright() as p:
    b = p.chromium.launch(); page = b.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)) if 'Wake Lock' not in str(e) else None)
    page.goto('http://127.0.0.1:8000/')
    page.wait_for_selector('[data-open]:not([hidden])', timeout=30000)
    page.locator('[data-file]').set_input_files(str(REV1))
    page.wait_for_function('window.EJS_emulator?.started', timeout=90000)
    page.wait_for_timeout(4000)
    shown = page.locator('[data-error]:not([hidden])').count()
    page.screenshot(path=str(ROOT / 'build/rev1-boot.png'))
    b.close()
assert not shown and not errors, (shown, errors)
print('FireRed v1.1 file → the Code Red build boots')
