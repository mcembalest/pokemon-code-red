#!/usr/bin/env python3
"""Diagnose the player on emulated iPhone Safari (Playwright WebKit).

Opens the player like a phone user: choose the base file, then wait. Records
status/error text, console output, page errors and screenshots over time.
Writes build/mobile/*.png and build/mobile/report.json. Prints a summary.

  python3 player/tests/mobile.py [--url http://127.0.0.1:8000/] [--tap]
"""
import argparse, json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'build/mobile'

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default='http://127.0.0.1:8000/')
    ap.add_argument('--engine', default='webkit', choices=['webkit', 'chromium'])
    ap.add_argument('--out', default=None)
    args = ap.parse_args()
    global OUT
    if args.out: OUT = Path(args.out)
    OUT.mkdir(parents=True, exist_ok=True)
    report = {'console': [], 'errors': [], 'samples': []}
    with sync_playwright() as p:
        device = dict(p.devices['iPhone 13'])
        browser = getattr(p, args.engine).launch()
        ctx = browser.new_context(**device)
        page = ctx.new_page()
        page.on('console', lambda m: report['console'].append(f'{m.type}: {m.text}'[:300]))
        page.on('pageerror', lambda e: report['errors'].append(str(e)[:500]))
        page.goto(args.url)
        page.wait_for_function('document.querySelector("[data-open]")?.hidden === false', timeout=30000)
        page.locator('[data-file]').set_input_files(str(ROOT / 'local/baserom.gba'))
        sample = '''() => {
          const q = s => document.querySelector(s);
          const ejs = window.EJS_emulator, gm = ejs?.gameManager;
          const canvas = q('#code-red-game canvas');
          return {
            status: q('[data-status]')?.textContent, error: q('[data-error]')?.hidden ? null : q('[data-error]')?.textContent,
            started: !!ejs?.started, paused: ejs?.paused ?? null, failed: !!ejs?.failedToStart,
            frame: gm?.functions?.getFrameNum?.() ?? null,
            abi: gm?.Module?._ejs_cr_abi?.() ?? null,
            canvas: canvas ? { w: canvas.width, h: canvas.height, cw: canvas.clientWidth, ch: canvas.clientHeight } : null,
            webgl2: ejs?.webgl2Enabled ?? null, safari: ejs?.isSafari ?? null, mobile: ejs?.isMobile ?? null,
            audio: (() => { try { let s = null; gm.Module.AL.currentCtx.sources.forEach(c => s = c.gain.context.state); return s } catch { return null } })(),
            popups: [...document.querySelectorAll('.ejs_popup_container, .ejs_popup_body')].map(e => e.textContent.slice(0, 80)),
            startButton: !!q('.ejs_start_button'),
          }
        }'''
        for i, wait in enumerate([3000, 7000, 10000, 15000]):
            page.wait_for_timeout(wait)
            s = page.evaluate(sample)
            report['samples'].append(s)
            page.screenshot(path=str(OUT / f'phone-{i}.png'))
        # Touch regression: a tap must press once and release once, after the
        # press (not cancelled in the same instant). And the 10x toggle works.
        page.evaluate(r'''window.calls = []; const f = EJS_emulator.gameManager.functions;
          for (const name of ['simulateInput', 'toggleFastForward']) { const o = f[name]; f[name] = (...a) => { calls.push(name + ':' + a.join(',')); return o(...a) } }''')
        for sel, index in (('.b_start', 3), ('.b_a', 8)):
            if page.locator(sel).count():
                page.locator(sel).first.tap(); page.wait_for_timeout(300)
        page.evaluate("calls.push('--speed--')")
        for _ in range(2):
            page.locator('[data-speed]').tap(); page.wait_for_timeout(300)
        calls = page.evaluate('calls')
        report['touch_calls'] = calls
        presses = {i: [c for c in calls if c.startswith(f'simulateInput:0,{i},')] for i in (3, 8)}
        report['touch_ok'] = all(p == [f'simulateInput:0,{i},1', f'simulateInput:0,{i},0'] for i, p in presses.items())
        report['speed_ok'] = [c for c in calls[calls.index('--speed--'):] if c.startswith('toggleFastForward')] == ['toggleFastForward:1', 'toggleFastForward:0']
        if report['samples'][-1]['popups'] or report['samples'][-1]['startButton']:
            page.locator('#code-red-game').tap(position={'x': 100, 'y': 100})
            page.wait_for_timeout(8000)
            report['after_tap'] = page.evaluate(sample)
            page.screenshot(path=str(OUT / 'phone-after-tap.png'))
        browser.close()
    (OUT / 'report.json').write_text(json.dumps(report, indent=2))
    print(json.dumps({k: v for k, v in report.items() if k != 'console'}, indent=2))
    print('\n'.join(report['console'][-40:]))
    if not (report.get('touch_ok') and report.get('speed_ok')):
        raise SystemExit(f"FAIL touch_ok={report.get('touch_ok')} speed_ok={report.get('speed_ok')} calls={report.get('touch_calls')}")

if __name__ == '__main__':
    main()
