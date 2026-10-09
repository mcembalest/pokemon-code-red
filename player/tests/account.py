#!/usr/bin/env python3
"""Invite gate + progress tracking in Chromium, against a mock backend.

Needs: make player, local/baserom.gba, scripts/serve_player.py on :8000.
  python3 player/tests/account.py
Checks: invite form gates the game; bad code shows an error; ?invite= prefills
and is removed after joining; session persists across reload; session_start is
sent; progress snapshots (from RAM) reach the backend via the page-hide beacon;
the cloud save is asked for on start; another device logging in pauses this one
until the player logs in here again (takeover).
"""
import json, os, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'build/account'
GOOD = 'RED-TEST-CODE'
received = {'joins': [], 'events': [], 'auth': [], 'saves_get': 0, 'logins': []}
state = {'active': True, 'tokens': {'tok-1'}, 'recovery': 'ABCD-EFGH-JKLM'}


class Api(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def cors(self):
        self.send_header('access-control-allow-origin', self.headers.get('origin') or '*')
        self.send_header('access-control-allow-headers', 'authorization, content-type')
        self.send_header('access-control-allow-methods', 'GET, POST, PUT, OPTIONS')
    def reply(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status); self.cors()
        self.send_header('content-type', 'application/json'); self.send_header('content-length', str(len(data)))
        self.end_headers(); self.wfile.write(data)
    def do_OPTIONS(self):
        self.send_response(204); self.cors(); self.end_headers()
    def do_GET(self):
        tok = (self.headers.get('authorization') or '').removeprefix('Bearer ')
        ok = tok in state['tokens']
        if self.path == '/v1/me':
            active = ok and (state['active'] or tok in ('tok-2', 'tok-3'))
            return self.reply(200 if ok else 401, {'player': {'id': 'p1', 'name': 'Misty', 'username': 'misty'}, 'active': active, 'has_recovery': True, 'features': {'agents': True}} if ok else {'error': 'invalid token'})
        if self.path == '/v1/save':
            received['saves_get'] += 1
            return self.reply(200 if ok else 401, {'version': 0} if ok else {'error': 'invalid token'})
        self.reply(404, {})
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get('content-length') or 0)) or b'{}')
        if self.path == '/v1/join':
            received['joins'].append(body)
            if body.get('invite', '').strip().upper() != GOOD:
                return self.reply(403, {'error': 'invite not valid'})
            if not body.get('username') or len(body.get('password', '')) < 8:
                return self.reply(400, {'error': 'username and password required'})
            return self.reply(201, {'token': 'tok-1', 'player': {'id': 'p1', 'name': body['name'], 'username': body['username'].lower()}, 'active': True, 'recovery': state['recovery'], 'features': {'agents': True}})
        if self.path == '/v1/recover':
            received.setdefault('recovers', []).append(body)
            if body.get('recovery', '').upper() != state['recovery'] or len(body.get('password', '')) < 8:
                return self.reply(401, {'error': 'wrong username or recovery code'})
            state['tokens'] = {'tok-3'}; state['recovery'] = 'NEWC-ODEX-XXXX'
            return self.reply(200, {'token': 'tok-3', 'player': {'id': 'p1', 'name': 'Misty', 'username': 'misty'}, 'active': True, 'recovery': state['recovery'], 'features': {'agents': True}})
        if self.path == '/v1/login':
            received['logins'].append(body)
            if body.get('password') != 'starmie-123':
                return self.reply(401, {'error': 'wrong username or password'})
            state['tokens'].add('tok-2')
            return self.reply(200, {'token': 'tok-2', 'player': {'id': 'p1', 'name': 'Misty', 'username': 'misty'}, 'active': True, 'features': {'agents': True}})
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
        page.fill('[data-invite]', 'RED-NOPE-NOPE'); page.fill('[data-name]', 'Misty')
        page.fill('[data-username]', 'misty'); page.fill('[data-password]', 'starmie-123'); page.click('[data-join] button')
        page.wait_for_selector('[data-error]:not([hidden])', timeout=10000)
        assert 'not valid' in page.text_content('[data-error]')
        page.fill('[data-invite]', GOOD.lower()); page.click('[data-join] button')
        # The recovery code is shown once, and the game waits until it is acknowledged.
        page.wait_for_selector('[data-recovery]:not([hidden])', timeout=15000)
        assert page.text_content('[data-recovery-code]') == 'ABCD-EFGH-JKLM'
        assert page.locator('[data-open]').is_hidden()
        page.screenshot(path=str(OUT / 'recovery.png'))
        page.click('[data-recovery-ok]')
        page.wait_for_selector('[data-open]:not([hidden])', timeout=15000)
        assert page.locator('[data-recovery]').is_hidden()
        assert page.locator('[data-join]').is_hidden()
        assert 'invite=' not in page.url, page.url
        assert 'Misty' in page.text_content('[data-who]')
        assert received['joins'][-1]['username'] == 'misty' and received['joins'][-1]['password'] == 'starmie-123'
        print('join ok', flush=True)

        # 2. Game starts; session_start is sent right away with the auth header.
        page.locator('[data-file]').set_input_files(str(ROOT / 'local/baserom.gba'))
        page.wait_for_function('window.EJS_emulator?.started', timeout=90000)
        wait(lambda: any(e['kind'] == 'session_start' for e in received['events']), 30, 'session_start')
        assert received['auth'][0] == 'Bearer tok-1', received['auth']
        assert received['saves_get'] >= 1, 'the cloud save must be asked for on start'
        start = next(e for e in received['events'] if e['kind'] == 'session_start')['data']
        assert start.get('cloud') == 'none', start
        print('session_start + cloud save check ok', flush=True)
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

        # 5. Takeover: another device logged in → this one is paused until the player logs in here.
        state['active'] = False
        page.goto('http://127.0.0.1:8000/?api=' + api_url)
        page.wait_for_selector('[data-signedout]:not([hidden])', timeout=30000)
        page.wait_for_function('window.EJS_emulator?.started', timeout=90000)
        page.wait_for_function('window.EJS_emulator?.paused === true', timeout=15000)
        page.screenshot(path=str(OUT / 'signed-out.png'))
        page.click('[data-play-here]')
        page.wait_for_selector('[data-login]:not([hidden])', timeout=5000)
        page.fill('[data-login-username]', 'misty'); page.fill('[data-login-password]', 'wrong-password'); page.click('[data-login] button')
        page.wait_for_selector('[data-error]:not([hidden])', timeout=10000)
        assert 'Wrong username' in page.text_content('[data-error]')
        # Forgot the password: the recovery code resets it, signs this device in, and shows a fresh code.
        page.click('[data-to-recover]')
        page.wait_for_selector('[data-recover]:not([hidden])', timeout=5000)
        page.fill('[data-recover-username]', 'misty'); page.fill('[data-recover-code]', 'wrong-code-0000'); page.fill('[data-recover-password]', 'starmie-456'); page.click('[data-recover] button')
        page.wait_for_selector('[data-error]:not([hidden])', timeout=10000)
        assert 'recovery code' in page.text_content('[data-error]')
        page.fill('[data-recover-code]', 'abcd-efgh-jklm'); page.click('[data-recover] button')
        page.wait_for_selector('[data-recovery]:not([hidden])', timeout=10000)
        assert page.text_content('[data-recovery-code]') == 'NEWC-ODEX-XXXX'
        page.click('[data-recovery-ok]')
        page.wait_for_selector('[data-recover]', state='hidden', timeout=10000)
        assert page.locator('[data-signedout]').is_hidden()
        page.wait_for_function('window.EJS_emulator?.paused === false', timeout=15000)
        assert len(received['logins']) == 1 and len(received['recovers']) == 2
        assert received['recovers'][-1]['password'] == 'starmie-456'
        assert page.evaluate('JSON.parse(localStorage.getItem("code-red-session")).token') == 'tok-3'
        assert 'recovery' not in page.evaluate('localStorage.getItem("code-red-session")')  # never stored on the page
        print('takeover + recovery ok', flush=True)
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
