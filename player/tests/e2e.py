#!/usr/bin/env python3
"""End-to-end check of player/dist in Chromium with the real ROM and CI-built core.

Needs: make player (dist built), local/baserom.gba, a server for player/dist
(python3 scripts/serve_player.py). Private: never publishes ROM bytes.

  python3 player/tests/e2e.py [--url http://127.0.0.1:8000/] [--phase boot|save|resume]
"""
import argparse, json, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'local/baserom.gba'
OUT = ROOT / 'build/e2e'
A, B, SELECT, START, RIGHT, LEFT, UP, DOWN = 8, 0, 2, 3, 7, 6, 4, 5

HELPERS = r'''
window.gm = EJS_emulator.gameManager;
window.frame = () => gm.functions.getFrameNum();
window.waitFrames = n => new Promise(r => { const f = frame(); const t = setInterval(() => { if (frame() > f + n) { clearInterval(t); r() } }, 4) });
window.press = async (k, hold = 6, after = 20) => { gm.simulateInput(0, k, 1); await waitFrames(hold); gm.simulateInput(0, k, 0); await waitFrames(after) };
window.fast = on => { gm.functions.setFastForwardRatio(10); gm.functions.toggleFastForward(on ? 1 : 0) };
window.ewram = () => { const m = gm.Module; return m.HEAPU8.subarray(m._ejs_cr_ewram(), m._ejs_cr_ewram() + 0x40000) };
'''

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default='http://127.0.0.1:8000/')
    ap.add_argument('--profile', default=str(OUT / 'profile'))
    ap.add_argument('--phase', default='boot', choices=['boot', 'resume', 'backup'])
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    results = {}
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(args.profile, headless=True, args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        errors, external = [], []
        benign = ('Wake Lock',)  # headless Chromium denies screen wake lock
        page.on('pageerror', lambda e: any(b in str(e) for b in benign) or errors.append(str(e)))
        page.on('console', lambda m: m.type == 'error' and not any(b in m.text for b in benign) and errors.append('console: ' + m.text))
        page.on('request', lambda r: r.url.startswith(('http://127.0.0.1', 'blob:', 'data:')) or external.append(r.url))
        page.goto(args.url)
        # Either the ROM is cached from an earlier phase, or choose the base file.
        page.wait_for_function('document.querySelector("[data-open]")?.hidden === false || !!window.EJS_emulator', timeout=30000)
        if page.evaluate('!window.EJS_emulator'):
            page.locator('[data-file]').set_input_files(str(BASE))
        page.wait_for_function('window.EJS_emulator?.gameManager?.Module?._ejs_cr_abi && window.EJS_emulator.started', timeout=90000)
        page.wait_for_timeout(1500)
        page.evaluate(HELPERS)
        results['core_abi'] = page.evaluate('gm.Module._ejs_cr_abi()')
        results['bridge_error'] = page.evaluate('document.querySelector("[data-error]").hidden ? null : document.querySelector("[data-error]").textContent')
        assert results['core_abi'] == 1 and results['bridge_error'] is None, results
        print('boot ok', flush=True)

        if args.phase == 'boot':
            # Intro -> player naming screen; typed name via DOM -> rival naming.
            name = page.locator('.code-red-text-entry:not([hidden]) input')
            def drive_to_naming():
                page.evaluate('''fast(true); window.driver = setInterval(() => { const f = frame();
                  gm.simulateInput(0, 3, f % 600 < 10 ? 1 : 0); gm.simulateInput(0, 8, f % 60 < 6 ? 1 : 0);
                  if (document.querySelector('.code-red-text-entry:not([hidden])')) { clearInterval(driver); gm.simulateInput(0, 3, 0); gm.simulateInput(0, 8, 0); fast(false) } }, 4)''')
                name.wait_for(timeout=180000)
            drive_to_naming()
            name.fill('Claude'); name.press('Enter')
            page.wait_for_function('document.querySelector(".code-red-text-entry").hidden', timeout=30000)
            print('player named', flush=True)
            drive_to_naming()
            name.fill('Gary'); name.press('Enter')
            page.wait_for_function('document.querySelector(".code-red-text-entry").hidden', timeout=30000)
            print('rival named', flush=True)
            results['naming'] = True
            page.wait_for_timeout(1000)
            page.locator('canvas').screenshot(path=str(OUT / 'after-naming.png'))

            # Finish the intro: mash A (fast) until Oak's speech ends and the bedroom loads.
            page.evaluate('''(async () => { fast(true); for (let i = 0; i < 60; i++) await press(8, 4, 30); fast(false) })()''')
            page.wait_for_timeout(500)
            page.wait_for_function('frame() > 0', timeout=5000)
            page.wait_for_timeout(25000)
            page.locator('canvas').screenshot(path=str(OUT / 'bedroom.png'))

            # Calculation bridge, op 1 (fixed stats-sum in a QuickJS worker), injected via rom.json symbol.
            rom = json.loads((ROOT / 'build/rom/rom.json').read_text())
            calc = rom['symbols']['gCodeRedMailbox']['address'] - 0x02000000
            page.evaluate('''([o, op]) => { const h = ewram(), v = new DataView(h.buffer, h.byteOffset);
              v.setUint32(o, 0x31445243, true); v.setUint16(o + 4, 1, true); v.setUint32(o + 8, 9001, true); v.setUint32(o + 12, 0, true);
              v.setUint16(o + 16, op, true); v.setUint16(o + 18, 0, true); [45, 49, 49, 65, 65, 45].forEach((x, i) => v.setUint16(o + 20 + 2 * i, x, true));
              v.setUint32(o + 32, 0, true); v.setUint16(o + 6, 1, true) }''', [calc, 1])
            page.wait_for_function('o => new DataView(ewram().buffer, ewram().byteOffset).getUint16(o + 6, true) === 2', arg=calc, timeout=15000)
            results['calc_op1'] = page.evaluate('o => { const v = new DataView(ewram().buffer, ewram().byteOffset); return { status: v.getUint16(o + 18, true), result: v.getUint32(o + 32, true) } }', calc)
            assert results['calc_op1'] == {'status': 0, 'result': 318}, results['calc_op1']
            print('calc op1 ok', flush=True)
            page.evaluate('o => { const v = new DataView(ewram().buffer, ewram().byteOffset); v.setUint16(o + 6, 0, true) }', calc)

            # Op 2: scratchpad dialog opens, game pauses, code runs in QuickJS, result returns on close.
            page.evaluate('''([o, op]) => { const h = ewram(), v = new DataView(h.buffer, h.byteOffset);
              v.setUint32(o + 8, 9002, true); v.setUint32(o + 12, 0, true); v.setUint16(o + 16, op, true); v.setUint16(o + 6, 1, true) }''', [calc, 2])
            dialog = page.locator('dialog.code-red-repl[open]')
            dialog.wait_for(timeout=15000)
            assert page.evaluate('EJS_emulator.paused'), 'game should pause while scratchpad is open'
            source = dialog.locator('[data-repl-source]')
            source.fill('input.stats.reduce((sum, n) => sum + n, 0)'); source.press('Enter')
            page.wait_for_function('document.querySelector("[data-repl-transcript]").lastElementChild?.lastElementChild?.textContent === "318"', timeout=15000)
            source.fill('typeof fetch + "," + typeof document'); source.press('Enter')
            page.wait_for_function('document.querySelector("[data-repl-transcript]").lastElementChild?.lastElementChild?.textContent === "\\"undefined,undefined\\""', timeout=15000)
            source.fill('300 + 18'); source.press('Enter')
            page.wait_for_function('document.querySelector("[data-repl-transcript]").lastElementChild?.lastElementChild?.textContent === "318"', timeout=15000)
            page.screenshot(path=str(OUT / 'scratchpad.png'))
            source.press('Escape')
            page.wait_for_function('o => new DataView(ewram().buffer, ewram().byteOffset).getUint16(o + 6, true) === 2', arg=calc, timeout=15000)
            results['calc_op2'] = page.evaluate('o => { const v = new DataView(ewram().buffer, ewram().byteOffset); return { status: v.getUint16(o + 18, true), result: v.getUint32(o + 32, true) } }', calc)
            assert results['calc_op2'] == {'status': 0, 'result': 318}, results['calc_op2']
            assert not page.evaluate('EJS_emulator.paused'), 'game should resume after scratchpad closes'
            page.evaluate('o => { const v = new DataView(ewram().buffer, ewram().byteOffset); v.setUint16(o + 6, 0, true) }', calc)
            print('calc op2 (scratchpad) ok', flush=True)

            # Stale-epoch protection: a request stamped before a reset is cancelled, not answered.
            page.evaluate('''o => { const v = new DataView(ewram().buffer, ewram().byteOffset);
              v.setUint32(o + 8, 9003, true); v.setUint32(o + 12, gm.Module._ejs_cr_epoch() + 77, true); v.setUint16(o + 16, 1, true); v.setUint16(o + 6, 1, true) }''', calc)
            page.wait_for_function('o => new DataView(ewram().buffer, ewram().byteOffset).getUint16(o + 6, true) === 4', arg=calc, timeout=15000)
            page.evaluate('o => { const v = new DataView(ewram().buffer, ewram().byteOffset); v.setUint16(o + 6, 0, true) }', calc)
            results['calc_stale_cancelled'] = True
            print('stale request cancelled ok', flush=True)

            # In-game save: Start -> menu screenshot (navigate after looking).
            page.evaluate('press(3, 6, 40)')
            page.wait_for_timeout(1500)
            page.locator('canvas').screenshot(path=str(OUT / 'start-menu.png'))
            # BAG, <name>, SAVE: down twice, A, confirm YES, wait for the write.
            for i, key in enumerate([DOWN, DOWN, A]):
                page.evaluate(f'press({key}, 6, 30)')
                page.wait_for_timeout(800)
                page.locator('canvas').screenshot(path=str(OUT / f'save-step-{i}.png'))
            page.wait_for_timeout(2500)
            page.locator('canvas').screenshot(path=str(OUT / 'save-prompt.png'))
            page.evaluate(f'press({A}, 6, 30)')
            page.wait_for_timeout(8000)
            page.locator('canvas').screenshot(path=str(OUT / 'saved.png'))
            page.evaluate('(async () => { await press(8, 6, 30) })()')
            page.wait_for_timeout(1000)
            # Force the autosave flush (it also runs every 10 s and on page hide).
            page.evaluate('document.dispatchEvent(new Event("visibilitychange"))')
            page.evaluate('window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }))')
            page.wait_for_timeout(12000)
            results['save'] = page.evaluate('''(async () => {
              gm.saveSaveFiles(); const sav = gm.getSaveFile(false);
              const db = await new Promise((ok, no) => { const r = indexedDB.open('code-red-local', 1); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error) });
              const backup = await new Promise(ok => { const t = db.transaction('files').objectStore('files').get('sav:41cb23d8dccc8ebd7c649cd8fbb58eeace6e2fdc'); t.onsuccess = () => ok(t.result) });
              const nonFF = a => a ? a.reduce((n, b) => n + (b !== 0xff ? 1 : 0), 0) : 0;
              let same = !!sav && !!backup && sav.length === backup.byteLength;
              if (same) { const b = new Uint8Array(backup); for (let i = 0; i < sav.length; i++) if (sav[i] !== b[i]) { same = false; break } }
              return { path: gm.getSaveFilePath(), bytes: sav?.length ?? 0, written: nonFF(sav), backup_bytes: backup?.byteLength ?? 0, backup_matches: same }
            })()''')
            print('save', results['save'], flush=True)
            assert results['save']['written'] > 1000 and results['save']['backup_matches'], results['save']
            (OUT / 'sav-fingerprint.json').write_text(json.dumps({'written': results['save']['written']}))

        if args.phase == 'resume':
            # A different ROM build (new rom.json) must still find the in-game save.
            rom = json.loads((ROOT / 'build/rom/rom.json').read_text())
            results['rom_sha1'] = rom['rom_sha1']
            results['restored_from_source'] = page.evaluate("""(async () => {
              const db = await new Promise(ok => { const r = indexedDB.open('code-red-local', 1); r.onsuccess = () => ok(r.result) });
              return await new Promise(ok => { const t = db.transaction('files').objectStore('files').getAllKeys(); t.onsuccess = () => ok(t.result) });
            })()""")
            before = json.loads((OUT / 'sav-fingerprint.json').read_text())['written']
            results['sav_written'] = page.evaluate('(() => { const a = gm.getSaveFile(false); return a ? a.reduce((n, b) => n + (b !== 0xff ? 1 : 0), 0) : 0 })()')
            assert results['sav_written'] == before, (results['sav_written'], before)
            # Title -> menu: CONTINUE should be offered, then load into the saved game.
            page.evaluate('''(async () => { fast(true); for (let i = 0; i < 10; i++) await press(3, 4, 40); fast(false) })()''')
            page.wait_for_timeout(4000)
            page.locator('canvas').screenshot(path=str(OUT / 'resume-menu.png'))
            page.evaluate(f'(async () => {{ await press({A}, 6, 120) }})()')
            page.wait_for_timeout(5000)
            page.locator('canvas').screenshot(path=str(OUT / 'resumed.png'))
            print('resume', results, flush=True)
            # Simulate losing EmulatorJS's own save file; the next load must restore our backup.
            page.evaluate('''new Promise(ok => { const fs = gm.FS, path = gm.getSaveFilePath(); fs.unlink(path); fs.syncfs(false, ok) })''')

        if args.phase == 'backup':
            page.wait_for_function('document.querySelector("[data-status]").textContent === "Restored your save."', timeout=30000)
            page.wait_for_timeout(2000)
            results['sav_written'] = page.evaluate('(() => { const a = gm.getSaveFile(false); return a ? a.reduce((n, b) => n + (b !== 0xff ? 1 : 0), 0) : 0 })()')
            before = json.loads((OUT / 'sav-fingerprint.json').read_text())['written']
            assert results['sav_written'] == before, (results['sav_written'], before)
            results['restored_from_backup'] = True
            print('backup restore ok', flush=True)

        results['external_requests'] = external
        results['errors'] = errors
        ctx.close()
    (OUT / f'{args.phase}.json').write_text(json.dumps(results, indent=2))
    print(json.dumps(results, indent=2))
    if external or errors:
        sys.exit('FAIL: external requests or page errors')

if __name__ == '__main__':
    main()
