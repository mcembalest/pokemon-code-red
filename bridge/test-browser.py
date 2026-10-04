"""Private real Chromium/core/ROM checks; serve with scripts/serve.py first."""
from pathlib import Path
import json, re, shutil
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
maptext=(root/'.cache/pokefirered/pokefirered.map').read_text()
addr=lambda name:int(re.search(r'(0x[0-9a-f]+)\s+'+name,maptext).group(1),16)
delta=addr('gStringVar1')-addr('gCodeRedMailbox')
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
 page=browser.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
 errors=[];requests=[]
 page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:requests.append(r.url))
 page.add_init_script('window.workerCounts={created:0,terminated:0};const Native=Worker;window.Worker=class extends Native{constructor(...a){super(...a);this.runnerWorker=a[1]?.type==="module";if(this.runnerWorker)workerCounts.created++}terminate(){if(this.runnerWorker)workerCounts.terminated++;super.terminate()}}')
 page.goto('http://127.0.0.1:8000/bridge/test');page.wait_for_function('window.ready',timeout=60000)
 page.evaluate('''window.gm=EJS_emulator.gameManager;window.mode='hold';window.replies=[];
 const m=gm.Module, reply=m._ejs_code_red_reply; m._ejs_code_red_reply=(...a)=>{const accepted=reply(...a);replies.push({args:a,accepted});return accepted};
 const run=controller.runner.run.bind(controller.runner); window.realRun=run;
 controller.runner.run=(source,input)=>mode==='hold'?new Promise(resolve=>window.release=()=>run(source,input).then(resolve)):mode==='silent'?new Promise(()=>{}):run(mode==='error'?'throw Error("test failure")':source,input);
 window.startDriver=(boot=false)=>{gm.functions.setFastForwardRatio(10);gm.functions.toggleFastForward(1);window.driver=setInterval(()=>{const f=gm.functions.getFrameNum();const k=boot&&f>=600&&f<615?3:f>630&&f%60<8?8:-1;gm.simulateInput(0,3,k===3?1:0);gm.simulateInput(0,8,k===8?1:0);if(controller.pending){clearInterval(driver);gm.simulateInput(0,3,0);gm.simulateInput(0,8,0);gm.functions.toggleFastForward(0)}},4)};
 window.readText=(delta)=>{const m=gm.Module,h=m.HEAPU8,v=new DataView(h.buffer);for(let i=0;i<h.length-36;i+=4){if(v.getUint32(i,true)===0x31445243&&v.getUint16(i+4,true)===1&&v.getUint16(i+16,true)===1&&v.getUint16(i+20,true)===45&&v.getUint16(i+22,true)===49&&v.getUint16(i+30,true)===45&&i+delta>=0){const out=[];for(let j=i+delta;j<i+delta+30;j++){out.push(h[j]);if(h[j]===255)break}if(out.length<30)return out}}return []};''')
 def text():return page.evaluate('delta=>readText(delta)',delta)
 def wait_text(expected):
  page.wait_for_function('([delta,expected])=>JSON.stringify(readText(delta))===JSON.stringify(expected)',arg=[delta,expected],timeout=15000)
 def capture(name):page.locator('canvas').screenshot(path=str(root/f'build/browser-mailbox-{name}.png'))
 def next_request():
  page.evaluate("mode='hold';startDriver()")
  page.wait_for_function('controller.pending',timeout=30000)
  return page.evaluate('controller.pending')
 def release():page.evaluate('release()')
 page.evaluate('startDriver(true)');page.wait_for_function('controller.pending',timeout=120000)
 first=page.evaluate('controller.pending');assert first['stats']==[45,49,49,65,65,45]
 release();wait_text([0xa4,0xa2,0xa9,0xff]);page.wait_for_timeout(500);capture('success')
 results={'actualBrowserNES':True,'stats':first['stats'],'quickjsResult':318,'inGame318':True,'frontend':'4.2.3','exports':page.evaluate('Object.keys(gm.Module).filter(k=>k.includes("code_red"))')}
 for _ in range(2):next_request();release();wait_text([0xa4,0xa2,0xa9,0xff])
 results['repeatedActions']=3
 next_request();page.evaluate("mode='error';controller.cancel();controller.poll()")
 # FireRed encoded 'Runner error'.
 wait_text([0xcc,0xe9,0xe2,0xe2,0xd9,0xe6,0x00,0xd9,0xe6,0xe6,0xe3,0xe6,0xff]);page.wait_for_timeout(500);capture('error');results['runnerError']=True
 pending=next_request();page.evaluate('gm.simulateInput(0,0,1)');page.wait_for_timeout(100);page.evaluate('gm.simulateInput(0,0,0)')
 cancelled=[0xbd,0xd5,0xe2,0xd7,0xd9,0xe0,0xe0,0xd9,0xd8,0xff]
 wait_text(cancelled);page.wait_for_timeout(500);capture('cancel');page.evaluate('release()');page.wait_for_timeout(200);assert page.evaluate('controller.pending') is None;results['bCancelStaleOutput']=True
 next_request();page.evaluate('gm.functions.setFastForwardRatio(10);gm.functions.toggleFastForward(1)')
 timeout=[0xce,0xdd,0xe1,0xd9,0xd8,0x00,0xe3,0xe9,0xe8,0xff]
 wait_text(timeout);page.evaluate('gm.functions.toggleFastForward(0)');page.wait_for_timeout(500);capture('timeout');page.evaluate('release()');results['romFrameTimeout']=True
 pending=next_request();page.evaluate('window.pendingState=gm.getState();window.oldEpoch=gm.Module._ejs_code_red_epoch();gm.loadState(pendingState)')
 page.wait_for_function('gm.Module._ejs_code_red_epoch()!==oldEpoch');wait_text(cancelled)
 assert page.evaluate('p=>gm.Module._ejs_code_red_reply(p.epoch,p.id,0,318)',pending)==0
 page.evaluate('release()');results['pendingStateLoadRejectsStale']=True
 pending=next_request();page.evaluate('window.oldEpoch=gm.Module._ejs_code_red_epoch();gm.functions.toggleRewind(1)')
 page.wait_for_function('gm.Module._ejs_code_red_epoch()!==oldEpoch',timeout=10000)
 page.evaluate('gm.functions.toggleRewind(0)')
 assert page.evaluate('p=>gm.Module._ejs_code_red_reply(p.epoch,p.id,0,318)',pending)==0
 page.evaluate('release()');results['rewindRejectsStale']=True
 pending=next_request();page.evaluate('window.oldEpoch=gm.Module._ejs_code_red_epoch();gm.restart()')
 page.wait_for_function('gm.Module._ejs_code_red_epoch()!==oldEpoch')
 assert page.evaluate('p=>gm.Module._ejs_code_red_reply(p.epoch,p.id,0,318)',pending)==0
 page.evaluate('release()');results['resetRejectsStale']=True
 # Restore pending state after reset: the core must cancel it again.
 page.evaluate('window.oldEpoch=gm.Module._ejs_code_red_epoch();gm.loadState(pendingState)')
 page.wait_for_function('gm.Module._ejs_code_red_epoch()!==oldEpoch');wait_text(cancelled)
 next_request();page.evaluate('Object.defineProperty(document,"hidden",{configurable:true,get:()=>true});document.dispatchEvent(new Event("visibilitychange"))')
 assert page.evaluate('controller.pending') is None
 page.evaluate('release();Object.defineProperty(document,"hidden",{configurable:true,get:()=>false})');page.wait_for_timeout(300);results['hideCancelsStale']=True
 buttons=page.locator('.ejs_virtualGamepad_button');a=buttons.filter(has_text=re.compile('^A$'));start=buttons.filter(has_text=re.compile('^Start$'))
 assert a.is_visible() and start.is_visible()
 page.evaluate('window.inputs=[];const input=gm.simulateInput.bind(gm);gm.simulateInput=(...a)=>{inputs.push(a);return input(...a)}')
 a.tap();page.wait_for_timeout(150);a.tap();start.tap();page.wait_for_timeout(150);inputs=page.evaluate('inputs');print("Touch inputs", inputs, flush=True);assert [0,8,1] in inputs and [0,8,0] in inputs and [0,3,1] in inputs and [0,3,0] in inputs
 results['mobileTouchDelivery']=True
 page.evaluate('controller.dispose()');page.wait_for_timeout(500)
 results['workers']=page.evaluate('workerCounts');assert results['workers']['created']==results['workers']['terminated'],results
 external=[u for u in requests if not u.startswith(('http://127.0.0.1:8000/','blob:','data:'))];assert not external,external
 assert not errors,errors;results['externalRequests']=external
 (root/'build/browser-mailbox.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(results,indent=2),flush=True);browser.close()
