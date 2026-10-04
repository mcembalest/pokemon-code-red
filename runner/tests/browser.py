"""Real Chromium Worker/WASM checks. Requires installed Python Playwright/Chromium."""
import functools
import http.server
import json
from pathlib import Path
import threading
import shutil
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_): pass
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=root / 'dist'))
threading.Thread(target=server.serve_forever, daemon=True).start()
origin = f'http://127.0.0.1:{server.server_port}'
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=shutil.which('chromium') or shutil.which('chromium-browser'), args=['--no-sandbox'])
        page = browser.new_page(viewport={'width':390,'height':844})
        requests = []
        page.on('request', lambda r: requests.append(r.url))
        page.add_init_script('''window.workerCounts={created:0,terminated:0};const Native=Worker;window.Worker=class extends Native{constructor(...args){super(...args);workerCounts.created++;window.lastWorker=this}terminate(){workerCounts.terminated++;super.terminate()}}''')
        page.goto(origin)
        page.wait_for_function('document.querySelector("#run").onclick !== null')
        page.evaluate('''async()=>{window.Runner=(await import('./client.js')).Runner;window.r=new Runner();window.fixture=await(await fetch('./fixture.json')).text()}''')
        def run(source, data=None):
            return page.evaluate('([source,data])=>r.run(source,data??fixture)', [source,data])
        results = {}
        results['known'] = run('return {total:Object.values(input.baseStats).reduce((a,b)=>a+b,0)};')
        assert results['known'] == {'ok':True,'value':{'total':318}}
        results['capabilities'] = run('return [typeof fetch,typeof XMLHttpRequest,typeof WebSocket,typeof document,typeof localStorage,typeof indexedDB,typeof process,typeof require,typeof self,typeof EJS_emulator];')
        assert results['capabilities']['value'] == ['undefined']*10
        for name, source in {
            'infinite':'while(true){}',
            'allocation':'const a=[];while(true)a.push(new Array(10000).fill(42));',
            'heap_limit':'return new Uint8Array(32*1024*1024).length;',
            'stack':'function f(){return f()}return f();',
            'large_output':'return "x".repeat(100000);',
            'serialize_loop':'return {toJSON(){while(true){}}};',
            'cyclic':'const x={};x.x=x;return x;',
            'promise':'return Promise.resolve(42);',
            'import':'return import("https://example.com/guest.js");',
            'schema':'return JSON.parse(\'{"__proto__":{}}\');',
            'deep':'let x=0;for(let i=0;i<20;i++)x=[x];return x;',
            'unicode_output':'return "😀".repeat(1500);',
        }.items():
            results[name]=run(source)
            assert not results[name]['ok'], (name,results[name])
        assert not run('return 1', '{"a":NaN}')['ok']
        assert not run('x'*8193)['ok']
        assert not run('return input', '"'+'x'*4097+'"')['ok']
        results['cancel']=page.evaluate('async()=>{const p=r.run("while(true){}",fixture);r.cancel();return await p}')
        assert results['cancel']['error']=='cancelled'
        results['replace']=page.evaluate('async()=>{const a=r.run("while(true){}",fixture);const b=r.run("return 7",fixture);return [await a,await b]}')
        assert results['replace']==[{'ok':False,'error':'cancelled'},{'ok':True,'value':7}]
        results['stale']=page.evaluate('async()=>{const p=r.run("return 8",fixture);lastWorker.onmessage({data:{id:-1,ok:true,json:"999"}});return await p}')
        assert results['stale']=={'ok':True,'value':8}
        # Simulate pagehide; actual visibility transitions vary in headless mode.
        results['hide']=page.evaluate('async()=>{const p=r.run("while(true){}",fixture);window.dispatchEvent(new Event("pagehide"));return await p}')
        assert results['hide']['error']=='cancelled'
        results['visibility']=page.evaluate('async()=>{const p=r.run("while(true){}",fixture);Object.defineProperty(document,"hidden",{configurable:true,value:true});document.dispatchEvent(new Event("visibilitychange"));delete document.hidden;return await p}')
        assert results['visibility']['error']=='cancelled'
        results['responsive_during_compute']=page.evaluate('async()=>{let ticks=0;const timer=setInterval(()=>ticks++,10);await r.run("while(true){}",fixture);clearInterval(timer);return ticks}')
        assert results['responsive_during_compute']>=3
        # Hold the trusted WASM resource to exercise the outer startup deadline.
        page.route('**/emscripten-module.wasm', lambda route: None)
        results['wall_timeout']=run('return 1')
        assert results['wall_timeout']['error']=='wall-timeout'
        page.unroute('**/emscripten-module.wasm')
        for _ in range(20): assert run('globalThis.persist=1;return 1')['ok']
        assert run('return typeof persist')['value']=='undefined'
        results['workers']=page.evaluate('workerCounts')
        assert results['workers']['created']==results['workers']['terminated']
        assert not page.evaluate('r.active')
        assert all(url.startswith(origin) for url in requests), requests
        results['external_requests']=[]
        results['repeated_runs']=20
        results['responsive']=page.evaluate('1+1')==2
        page.locator('#run').click()
        page.wait_for_function('document.querySelector("#result").textContent.includes("318")')
        print(json.dumps(results,indent=2))
        browser.close()
finally:
    server.shutdown()
