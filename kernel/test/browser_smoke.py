#!/usr/bin/env python3
"""The kernel in Chromium: a Pokémon (pi-durable, in memory) uses moves through pi-ai → a mocked
/v1/ai route; its code runs in pi-codemode (QuickJS worker). Needs: node build.mjs.
  python3 kernel/test/browser_smoke.py
"""
import functools, http.server, json, shutil, sys, tempfile, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

DIST = Path(__file__).resolve().parents[1] / 'dist'
PAGE = """<!doctype html><meta charset=utf-8><script type=module>
import { setupBrowserKernel, createModels, gameApiProvider, openKernel, GAME_PROVIDER } from './kernel.js'
const out = {}
try {
  setupBrowserKernel(new URL('./', import.meta.url))
  const models = createModels()
  models.setProvider(gameApiProvider({ baseUrl: location.origin + '/v1/ai', token: 'session-abc' }))
  const k = await openKernel({ models })
  const mon = await k.createMon({ species: 'CHARMANDER', level: 5, memory: ['- scan first'], memoryLimit: 100 })
  const model = { provider: GAME_PROVIDER, modelId: '@cf/meta/llama-3.2-3b-instruct' }
  let foe = [9, 2, 7]
  const tools = [
    { name: 'scan', description: 'Read the foe.', inputSchema: { type: 'object', properties: {} }, execute: async () => ({ bytes: foe }) },
    { name: 'scratch', description: 'Scratch one slot.', inputSchema: { type: 'object', properties: { slot: { type: 'integer' } } }, execute: async ({ slot }) => { foe[slot] = 0; return 'ok' } },
  ]
  await mon.battle()
  for (const name of ['hit', 'crash', 'loop', 'tool']) {
    const t0 = performance.now()
    const r = await mon.useMove({ move: 'SCRATCH', task: name, tools, budget: 300, mode: name === 'tool' ? 'tool' : 'block', model })
    out[name] = { reason: r.reason, calls: r.run?.log.map(c => c.name + JSON.stringify(c.args ?? {})), spent: r.run?.spent, ms: Math.round(performance.now() - t0) }
  }
  out.foe = foe
  await k.close()
} catch (e) { out.error = String(e && e.stack || e) }
window.__result = out
</script>"""

REPLIES = {
    'hit': '```js\nconst f = await tools.scan()\nconst i = f.bytes.indexOf(Math.min(...f.bytes))\nawait tools.scratch({ slot: i })\n```',
    'crash': '```js\nawait tools.scan()\nthrow new Error("distracted by a butterfly")\n```',
    'loop': '```js\nwhile (true) {}\n```',
}


def sse(body):
    msgs = body['messages']
    task = msgs[-1]['content'] if isinstance(msgs[-1]['content'], str) else msgs[-1]['content'][0]['text']
    name = next(k for k in ['hit', 'crash', 'loop', 'tool'] if f'SCRATCH: {k}' in task)
    if name == 'tool':
        delta = {'role': 'assistant', 'tool_calls': [{'index': 0, 'id': 'call_1', 'type': 'function', 'function': {'name': 'code', 'arguments': json.dumps({'code': 'await tools.scratch({ slot: 0 })'})}}]}
        finish = 'tool_calls'
    else:
        delta, finish = {'role': 'assistant', 'content': REPLIES[name]}, 'stop'
    chunks = [{'id': 'c', 'object': 'chat.completion.chunk', 'model': 'm', 'choices': [{'index': 0, 'delta': delta, 'finish_reason': finish}]},
              {'id': 'c', 'object': 'chat.completion.chunk', 'model': 'm', 'choices': [], 'usage': {'prompt_tokens': 80, 'completion_tokens': 30, 'total_tokens': 110}}]
    return ''.join(f'data: {json.dumps(c)}\n\n' for c in chunks) + 'data: [DONE]\n\n'


def main():
    assert (DIST / 'kernel.js').exists(), 'run: node kernel/build.mjs'
    site = Path(tempfile.mkdtemp())
    shutil.copytree(DIST, site, dirs_exist_ok=True)
    (site / 'index.html').write_text(PAGE)
    class Handler(http.server.SimpleHTTPRequestHandler):
        extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.wasm': 'application/wasm', '.js': 'text/javascript'}
        def log_message(self, *a): pass
    handler = functools.partial(Handler, directory=str(site))
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    seen = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        def ai(route):
            body = json.loads(route.request.post_data)
            seen.append({'auth': route.request.headers.get('authorization'), 'body': body})
            route.fulfill(status=200, headers={'content-type': 'text/event-stream'}, body=sse(body))
        page.route('**/v1/ai/chat/completions', ai)
        page.goto(f'http://127.0.0.1:{srv.server_address[1]}/index.html')
        page.wait_for_function('window.__result', timeout=60000)
        r = page.evaluate('window.__result')
        browser.close()
    srv.shutdown()
    print(json.dumps(r, indent=1))
    assert not errors, errors
    assert 'error' not in r, r['error']
    assert r['hit'] == {'reason': None, 'calls': ['scan{}', 'scratch{"slot":1}'], 'spent': r['hit']['spent'], 'ms': r['hit']['ms']}
    assert r['crash']['reason'].startswith('script: ') and 'butterfly' in r['crash']['reason'], r['crash']
    assert r['loop']['reason'].startswith('timeout'), r['loop']
    assert r['tool']['reason'] is None and r['tool']['calls'] == ['scratch{"slot":0}'], r['tool']
    assert r['foe'] == [0, 0, 7]
    assert all(s['auth'] == 'Bearer session-abc' for s in seen)
    assert seen[0]['body']['messages'][0]['content'].startswith('You are CHARMANDER')
    assert any(t['function']['name'] == 'code' for t in seen[-1]['body'].get('tools', []))
    print('ok: kernel runs in the browser')


if __name__ == '__main__':
    sys.exit(main())
