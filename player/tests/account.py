#!/usr/bin/env python3
"""Invite gate + progress tracking in Chromium, against a mock backend.

Needs: make player, local/baserom.gba, scripts/serve_player.py on :8000.
  python3 player/tests/account.py
Checks: invite form gates the game; bad code shows an error; ?invite= prefills
and is removed after joining; session persists across reload; session_start is
sent; progress snapshots (from RAM) reach the backend via the page-hide beacon.
"""
import json, os, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'build/account'
GOOD = 'RED-TEST-CODE'
received = {'joins': [], 'events': [], 'auth': []}


class Api(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def cors(self):
        self.send_header('access-control-allow-origin', self.headers.get('origin') or '*')
        self.send_header('access-control-allow-headers', 'authorization, content-type')
        self.send_header('access-control-allow-methods', 'GET, POST, OPTIONS')
    def reply(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status); self.cors()
        self.send_header('content-type', 'application/json'); self.send_header('content-length', str(len(data)))
        self.end_headers(); self.wfile.write(data)
    def do_OPTIONS(self):
        self.send_response(204); self.cors(); self.end_headers()
    def do_GET(self):
        if self.path == '/v1/me':
            ok = self.headers.get('authorization') == 'Bearer tok-1'
            return self.reply(200 if ok else 401, {'player': {'id': 'p1', 'name': 'Misty'}} if ok else {'error': 'invalid token'})
        self.reply(404, {})
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get('content-length') or 0)) or b'{}')
        if self.path == '/v1/join':
            received['joins'].append(body)
            if body.get('invite', '').strip().upper() != GOOD:
                return self.reply(403, {'error': 'invite not valid'})
            return self.reply(201, {'token': 'tok-1', 'player': {'id': 'p1', 'name': body['name']}, 'features': {'agents': True}})
        if self.path == '/v1/events':
            auth = self.headers.get('authorization') or ('body:' + body.get('token', ''))
            received['auth'].append(auth)
            received['events'].extend(body.get('events', []))
            return self.reply(200, {'stored': len(body.get('events', []))})
        self.reply(404, {})


def wait(cond, timeout=30, what='condition'):
    end = time.time() + timeout
    while time.time() < end:
        if cond(): return
        time.sleep(0.2)
    raise AssertionError(f'timed out waiting for {what}; received={json.dumps(received)[:1500]}')


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    api = ThreadingHTTPServer(('127.0.0.1', 0), Api)
    threading.Thread(target=api.serve_forever, daemon=True).start()
    api_url = f'http://127.0.0.1:{api.server_address[1]}'
    url = f'http://127.0.0.1:8000/?api={api_url}&invite={GOOD.lower()}'
    rom = json.loads((ROOT / 'build/rom/rom.json').read_text())['symbols']
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        ctx = browser.new_context()
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: 'Wake Lock' in str(e) or errors.append(str(e)))
        page.goto(url)

        # 1. Gate: invite form first, ROM chooser hidden, code prefilled from the link.
        page.wait_for_selector('[data-join]:not([hidden])', timeout=15000)
        assert page.locator('[data-open]').is_hidden()
        assert page.locator('[data-invite]').input_value() == GOOD.lower()
        page.screenshot(path=str(OUT / 'invite.png'))
        page.fill('[data-invite]', 'RED-NOPE-NOPE'); page.fill('[data-name]', 'Misty'); page.click('[data-join] button')
        page.wait_for_selector('[data-error]:not([hidden])', timeout=10000)
        assert 'not valid' in page.text_content('[data-error]')
        page.fill('[data-invite]', GOOD.lower()); page.click('[data-join] button')
        page.wait_for_selector('[data-open]:not([hidden])', timeout=15000)
        assert page.locator('[data-join]').is_hidden()
        assert 'invite=' not in page.url, page.url
        assert 'Misty' in page.text_content('[data-who]')
        print('join ok', flush=True)

        # 2. Game starts; session_start is sent right away with the auth header.
        page.locator('[data-file]').set_input_files(str(ROOT / 'local/baserom.gba'))
        page.wait_for_function('window.EJS_emulator?.started', timeout=90000)
        wait(lambda: any(e['kind'] == 'session_start' for e in received['events']), 30, 'session_start')
        assert received['auth'][0] == 'Bearer tok-1', received['auth']
        print('session_start ok', flush=True)
        # Invited player → agents on by default, but the player picks moves: no autopilot button.
        page.wait_for_timeout(1500)
        assert page.locator('[data-agent]').is_hidden(), 'move autopilot must be off by default'
        print('agents on, autopilot off by default ok', flush=True)

        # 3. Progress: point save-block pointers at scratch EWRAM with a running play clock
        #    (the title screen has no loaded save), then hide the page → beacon.
        page.evaluate('''([sb1p, sb2p]) => {
          const m = EJS_emulator.gameManager.Module, e = m._ejs_cr_ewram(), i = m._ejs_cr_iwram();
          const iw = new DataView(m.HEAPU8.buffer, i), ew = new DataView(m.HEAPU8.buffer, e);
          const SB1 = 0x02030000, SB2 = 0x02034000;
          // Re-point every tick: the game sets its own pointers during boot.
          const point = () => { iw.setUint32(sb1p - 0x03000000, SB1, true); iw.setUint32(sb2p - 0x03000000, SB2, true) };
          point();
          ew.setUint8(SB1 - 0x02000000 + 4, 3); ew.setUint8(SB1 - 0x02000000 + 5, 19);        // Route 1
          ew.setUint8(SB1 - 0x02000000 + 0xee0 + 0x104, 0b11);                                 // badges 1+2
          window.__tick = setInterval(() => { point(); const o = SB2 - 0x02000000 + 0x11; ew.setUint8(o, (ew.getUint8(o) + 1) % 60) }, 500);
        }''', [rom['gSaveBlock1Ptr']['address'], rom['gSaveBlock2Ptr']['address']])
        page.wait_for_timeout(5000)  # watcher polls every 2 s: baseline snapshot
        page.evaluate('clearInterval(window.__tick); Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true }); document.dispatchEvent(new Event("visibilitychange"))')
        wait(lambda: any(e['kind'] == 'snapshot' for e in received['events']), 15, 'snapshot')
        snap = next(e for e in received['events'] if e['kind'] == 'snapshot')['data']
        assert snap['map'] == [3, 19] and snap['badge_count'] == 2, snap
        assert any(a == 'body:tok-1' for a in received['auth']), received['auth']  # beacon path
        print('snapshot ok', snap, flush=True)

        # 4. Reload: session persists, no form, game auto-restores.
        page.goto('http://127.0.0.1:8000/?api=' + api_url)
        page.wait_for_function('window.EJS_emulator?.started', timeout=90000)
        assert page.locator('[data-join]').is_hidden()
        assert 'Misty' in page.text_content('[data-who]')
        assert len(received['joins']) == 2
        print('reload ok', flush=True)
        page.screenshot(path=str(OUT / 'playing.png'))
        browser.close()
    api.shutdown()
    if errors:
        sys.exit('page errors: ' + '; '.join(errors))
    print(json.dumps({'events': [e['kind'] for e in received['events']]}))


if __name__ == '__main__':
    try:
        main()
    except BaseException as problem:
        if os.environ.get('GITHUB_ACTIONS') and not (isinstance(problem, SystemExit) and problem.code in (0, None)):
            print(f'::error title=account e2e::{type(problem).__name__}: {str(problem)[:800]}'.replace('\n', ' '), flush=True)
        raise
