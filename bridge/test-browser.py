"""Private Chromium/core/ROM checks; serve with scripts/serve.py first.

Run with --pcs-only for actual bedroom and Pokemon Center Code -> 318.
The default suite uses an explicitly private pre-action PC-menu state for
lifecycle isolation; native-pc-navigation covers natural menu return/repeat.
Boot caches are private, ignored, optional, and keyed by the actual ROM SHA1.
"""
from pathlib import Path
import json, re, shutil, subprocess, hashlib, sys
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
maptext=(root/'.cache/pokefirered/pokefirered.map').read_text()
addr=lambda name:int(re.search(r'(0x[0-9a-f]+)\s+'+name,maptext).group(1),16)
delta=addr('gStringVar1')-addr('gCodeRedMailbox')
symbols={name:int(a,16) for a,_,name in (line.split() for line in subprocess.check_output([str(root/'.cache/sysroot/usr/bin/arm-none-eabi-nm'),str(root/'.cache/pokefirered/pokefirered.elf')],text=True).splitlines() if len(line.split())==3)}
rom=(root/'build/code-red.gba').read_bytes()
header=list(rom[symbols['PalletTown_PlayersHouse_2F']-0x8000000:symbols['PalletTown_PlayersHouse_2F']-0x8000000+16])
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
  # Reset only the private navigation fixture. Load bumps the epoch; stale
  # work is cancelled by the same production controller used by the player.
  page.evaluate("mode='hold';gm.loadState(readyMenuState)");page.wait_for_timeout(500)
  page.evaluate('press(5)');page.evaluate('press(5)');page.evaluate('press(8)');page.evaluate('startDriver()')
  page.wait_for_function('controller.pending',timeout=30000)
  return page.evaluate('controller.pending')
 def release():page.evaluate('release()')
 cache=root/('build/private-browser-boot-'+hashlib.sha1(rom).hexdigest()+'.json')
 if cache.exists():
  page.evaluate('state=>gm.loadState(new Uint8Array(state))',json.loads(cache.read_text()));page.wait_for_timeout(1500)
 else:
  page.evaluate("window.bootDone=false;gm.functions.setFastForwardRatio(10);gm.functions.toggleFastForward(1);window.boot=setInterval(()=>{const f=gm.functions.getFrameNum();gm.simulateInput(0,3,f>=600&&f<615?1:0);gm.simulateInput(0,8,f>630&&f%60<8?1:0);if(f>7900){clearInterval(boot);gm.simulateInput(0,8,0);gm.functions.toggleFastForward(0);bootDone=true}},4)")
  page.wait_for_function('bootDone',timeout=120000);cache.write_text(json.dumps(page.evaluate('Array.from(gm.getState())')))

 assert page.evaluate('controller.pending') is None
 capture('nes-restored')
 # Private navigation fixture changes save position/map and the normal loader
 # callback. All menu interactions use actual emulator inputs; no guest API is added.
 page.evaluate("""([header,symbols])=>{
 const h=gm.Module.HEAPU8,v=new DataView(h.buffer);let ew=-1;
 // mGBA allocates EWRAM and IWRAM in one adjacent allocation.
 for(let i=0;i<h.length-16;i+=4){if(!header.every((b,j)=>h[i+j]===b))continue;const e=i-(symbols.gMapHeader-0x2000000),main=e+0x40000+symbols.gMain-0x3000000;if(main<0||main+8>=h.length)continue;if(v.getUint32(main,true)===(symbols.CB1_Overworld|1)&&v.getUint32(main+4,true)===(symbols.CB2_Overworld|1)){ew=e;break}}
 if(ew<0)throw Error('Live adjacent RAM fixture not found');
 window.ram=a=>a>=0x3000000?ew+0x40000+a-0x3000000:ew+a-0x2000000;
 window.readText=()=>{const h=gm.Module.HEAPU8,out=[];for(let j=ram(symbols.gStringVar1);j<ram(symbols.gStringVar1)+30;j++){out.push(h[j]);if(h[j]===255)break}return out};
 window.fixture=(group,map,x,y,flag)=>{const h=gm.Module.HEAPU8,v=new DataView(h.buffer),save=v.getUint32(ram(symbols.gSaveBlock1Ptr),true),o=ram(save);v.setInt16(o,x,true);v.setInt16(o+2,y,true);h[o+4]=group;h[o+5]=map;h[o+6]=255;v.setInt16(o+8,x,true);v.setInt16(o+10,y,true);if(flag!==undefined)h[o+0xee0+(flag>>3)]|=1<<(flag&7);v.setUint32(ram(symbols.gMain)+4,symbols.CB2_LoadMap|1,true);h[ram(symbols.gMain)+0x438]=0};
 window.press=async(k,n=8)=>{const f=gm.functions.getFrameNum();gm.simulateInput(0,k,1);await new Promise(r=>{const t=setInterval(()=>{if(gm.functions.getFrameNum()>f+n){clearInterval(t);r()}},4)});gm.simulateInput(0,k,0);await new Promise(r=>setTimeout(r,200))};
 }""",[header,symbols])
 page.evaluate('press(0,20)');page.wait_for_timeout(1000);page.evaluate('press(6,80)');page.evaluate('press(4,64)');page.evaluate('press(6,24)');page.evaluate('press(4,8)');page.wait_for_timeout(500);capture('bedroom-navigation');page.evaluate('press(8)');page.wait_for_timeout(500);page.evaluate('press(8)');page.wait_for_timeout(500);page.evaluate('press(8)');page.wait_for_timeout(2500);capture('bedroom-pc-menu');page.evaluate('window.readyMenuState=gm.getState()')
 page.evaluate('press(5)');page.evaluate('press(5)');page.evaluate('press(8)');page.evaluate('startDriver()');page.wait_for_function('controller.pending',timeout=30000)
 first=page.evaluate('controller.pending');assert first['stats']==[45,49,49,65,65,45]
 release();wait_text([0xa4,0xa2,0xa9,0xff]);page.wait_for_timeout(2000);capture('success');print('Bedroom PC QuickJS 318',flush=True)
 results={'romSHA1':hashlib.sha1(rom).hexdigest(),'coreSHA256':hashlib.sha256((root/'build/browser-core/mgba-wasm.data').read_bytes()).hexdigest(),'actualBrowserBedroomPC':True,'nesOriginalDialogueNoMailbox':True,'privateNavigationFixture':True,'stats':first['stats'],'quickjsResult':318,'inGame318':True,'frontend':'4.2.3','exports':page.evaluate('Object.keys(gm.Module).filter(k=>k.includes("code_red"))')}
 if '--pcs-only' in sys.argv:
  page.evaluate("mode='hold';fixture(5,4,13,3)");page.wait_for_timeout(2500)
  page.evaluate('press(6,64)');page.evaluate('press(4,16)');capture('center-navigation')
  page.evaluate('press(8)');page.wait_for_timeout(1500);page.evaluate('press(8)');page.wait_for_timeout(1000);page.evaluate('press(8)');page.wait_for_timeout(2500);capture('center-pc-menu')
  page.evaluate('press(5)');page.evaluate('press(5)');page.evaluate('press(8)');page.evaluate('startDriver()');page.wait_for_function('controller.pending',timeout=30000)
  release();wait_text([0xa4,0xa2,0xa9,0xff]);page.wait_for_timeout(2000);capture('center-success');results['actualBrowserPokemonCenterPC']=True
  page.evaluate('controller.dispose()');results['workers']=page.evaluate('workerCounts');assert results['workers']['created']==results['workers']['terminated']
  assert not errors,errors;results['externalRequests']=[u for u in requests if not u.startswith(('http://127.0.0.1:8000/','blob:','data:'))];assert not results['externalRequests']
  (root/'build/browser-pcs.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(results,indent=2),flush=True);browser.close();sys.exit(0)
 for _ in range(2):next_request();release();wait_text([0xa4,0xa2,0xa9,0xff])
 results['repeatedActionsViaPrivateMenuState']=3
 next_request();page.evaluate("mode='error';controller.cancel();controller.poll()")
 # FireRed encoded 'Runner error'.
 wait_text([0xcc,0xe9,0xe2,0xe2,0xd9,0xe6,0x00,0xd9,0xe6,0xe6,0xe3,0xe6,0xff]);page.wait_for_timeout(2000);capture('error');results['runnerError']=True
 pending=next_request();page.evaluate('gm.simulateInput(0,0,1)');page.wait_for_timeout(100);page.evaluate('gm.simulateInput(0,0,0)')
 cancelled=[0xbd,0xd5,0xe2,0xd7,0xd9,0xe0,0xe0,0xd9,0xd8,0xff]
 wait_text(cancelled);page.wait_for_timeout(2000);capture('cancel');page.evaluate('release()');page.wait_for_timeout(200);assert page.evaluate('controller.pending') is None;results['bCancelStaleOutput']=True
 next_request();page.evaluate('gm.functions.setFastForwardRatio(10);gm.functions.toggleFastForward(1)')
 timeout=[0xce,0xdd,0xe1,0xd9,0xd8,0x00,0xe3,0xe9,0xe8,0xff]
 wait_text(timeout);page.evaluate('gm.functions.toggleFastForward(0)');page.wait_for_timeout(2000);capture('timeout');page.evaluate('release()');results['romFrameTimeout']=True
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
