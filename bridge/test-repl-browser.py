"""Actual local Site player, naming fields, PC scratchpad and core lifecycle.

Uses the private baseline file; no ROM, save state, or asset is published.
Navigation fixtures only change ordinary map/position and its normal loader.
"""
from pathlib import Path
import hashlib,json,os,shutil,subprocess
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
url=os.environ.get('CODE_RED_SITE_URL','http://127.0.0.1:4323/pokemon-code-red')
origin=f'{urlsplit(url).scheme}://{urlsplit(url).netloc}/'
base=root/'.cache/pokefirered-baseline/pokefirered.gba'
symbols={name:int(a,16) for a,_,name in (line.split() for line in subprocess.check_output([str(root/'.cache/sysroot/usr/bin/arm-none-eabi-nm'),str(root/'.cache/pokefirered/pokefirered.elf')],text=True).splitlines() if len(line.split())==3)}
rom=(root/'build/code-red.gba').read_bytes();offset=symbols['PalletTown_PlayersHouse_2F']-0x08000000;header=list(rom[offset:offset+16])
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
 page=browser.new_page();errors=[];requests=[]
 page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:requests.append(r.url))
 page.add_init_script('window.workerCounts={created:0,terminated:0};const Native=Worker;window.Worker=class extends Native{constructor(...a){super(...a);this.owned=a[1]?.type==="module";if(this.owned)workerCounts.created++}terminate(){if(this.owned)workerCounts.terminated++;super.terminate()}}')
 page.goto(url);page.locator('[data-file]').set_input_files(str(base))
 page.wait_for_function('window.EJS_emulator?.gameManager&& !document.querySelector("[data-save]").disabled',timeout=60000)
 print('Integrated emulator ready',flush=True)
 page.evaluate('''window.gm=EJS_emulator.gameManager;window.m=gm.Module;window.replies=[];const reply=m._ejs_code_red_reply;m._ejs_code_red_reply=(...args)=>{const accepted=reply(...args);replies.push({args,accepted});return accepted};
 window.press=async(k,n=8)=>{const f=gm.functions.getFrameNum();gm.simulateInput(0,k,1);await new Promise(r=>{const t=setInterval(()=>{if(gm.functions.getFrameNum()>f+n){clearInterval(t);r()}},4)});gm.simulateInput(0,k,0);await new Promise(r=>setTimeout(r,200))};
 window.drive=()=>{gm.functions.setFastForwardRatio(10);gm.functions.toggleFastForward(1);window.driver=setInterval(()=>{const f=gm.functions.getFrameNum();gm.simulateInput(0,3,f>=600&&f<615?1:0);gm.simulateInput(0,8,f>630&&f%60<8?1:0);if(document.querySelector('.code-red-text-entry:not([hidden])')){clearInterval(driver);gm.simulateInput(0,3,0);gm.simulateInput(0,8,0);gm.functions.toggleFastForward(0)}},4)};drive();''')
 name=page.locator('.code-red-text-entry:not([hidden]) input')
 name.wait_for(timeout=120000);name.fill('Player');name.press('Enter');page.wait_for_function('document.querySelector(".code-red-text-entry").hidden')
 print('Player DOM naming confirmed',flush=True)
 page.evaluate('drive()');name.wait_for(timeout=120000);name.fill('Rival');name.press('Enter');page.wait_for_function('document.querySelector(".code-red-text-entry").hidden')
 print('Rival DOM naming confirmed',flush=True)
 page.evaluate('''([header,s])=>{const h=m.HEAPU8,v=new DataView(h.buffer);window.ew=-1;for(let i=0;i<h.length-60;i+=4){if(v.getUint32(i,true)!==0x314e5243)continue;const e=i-(s.gCodeRedNamingMailbox-0x2000000),o=e+0x40000+s.gSaveBlock2Ptr-0x3000000;if(o>0&&o+4<h.length){const pointer=v.getUint32(o,true);if(pointer>=0x2000000&&pointer<0x2040000){ew=e;break}}}if(ew<0)throw Error('Live naming RAM not found');window.findRAM=()=>{const h=m.HEAPU8,o=ew+s.gMapHeader-0x2000000;return header.every((b,j)=>h[o+j]===b)?ew:-1};window.s=s;window.room=false;gm.functions.toggleFastForward(1);window.driver=setInterval(()=>{const f=gm.functions.getFrameNum();gm.simulateInput(0,8,f%60<8?1:0);if(findRAM()>=0){clearInterval(driver);gm.simulateInput(0,8,0);gm.functions.toggleFastForward(0);room=true}},4)}''',[header,symbols])
 page.wait_for_function('room',timeout=120000)
 print('Bedroom reached',flush=True)
 page.evaluate('''window.ew=findRAM();window.ram=a=>a>=0x3000000?ew+0x40000+a-0x3000000:ew+a-0x2000000;
 window.fixture=()=>{const h=m.HEAPU8,v=new DataView(h.buffer),o=ram(v.getUint32(ram(s.gSaveBlock1Ptr),true));v.setInt16(o,1,true);v.setInt16(o+2,2,true);h[o+4]=4;h[o+5]=1;h[o+6]=255;v.setInt16(o+8,1,true);v.setInt16(o+10,2,true);v.setUint32(ram(s.gMain)+4,s.CB2_LoadMap|1,true);h[ram(s.gMain)+0x438]=0};
 window.gameText=()=>{const h=m.HEAPU8,out=[];for(let i=ram(s.gStringVar1);i<ram(s.gStringVar1)+40;i++){out.push(h[i]);if(h[i]===255)break}return out};fixture();''')
 page.wait_for_timeout(1800);page.evaluate('press(4)');page.evaluate('press(8)');page.wait_for_timeout(500);page.evaluate('press(8)');page.wait_for_timeout(500);page.evaluate('press(8)');page.wait_for_timeout(2500)
 page.locator('canvas').screenshot(path=str(root/'build/site-repl-pc-menu.png'))
 page.evaluate('window.readyMenu=gm.getState()')
 def open_console():
  page.evaluate('gm.loadState(readyMenu)');page.wait_for_timeout(500)
  page.evaluate('press(5)');page.evaluate('press(5)');page.evaluate('press(8)')
  # Acknowledges the original bounded console-launch prompt, then stops.
  page.evaluate('''window.launch=setInterval(()=>{const f=gm.functions.getFrameNum();gm.simulateInput(0,8,f%60<8?1:0);if(document.querySelector('dialog.code-red-repl[open]')){clearInterval(launch);gm.simulateInput(0,8,0)}},4)''')
  try:page.locator('dialog.code-red-repl[open]').wait_for(timeout=30000)
  except Exception:
   page.locator('canvas').screenshot(path=str(root/'build/site-repl-launch-failure.png'))
   print('Launch failure',page.evaluate('({text:gameText(),paused:EJS_emulator.paused,replies,errors:document.querySelector("[data-status]").textContent})'),errors,flush=True)
   raise
  assert page.evaluate('EJS_emulator.paused')
 dialog=page.locator('dialog.code-red-repl');source=dialog.locator('[data-repl-source]');transcript=dialog.locator('[data-repl-transcript]')
 def run(code,expected,mode='expression'):
  dialog.locator('[data-repl-mode]').select_option(mode);source.fill(code);source.press('Enter')
  page.wait_for_function('expected=>document.querySelector("[data-repl-transcript]").lastElementChild?.lastElementChild?.textContent===expected',arg=expected,timeout=10000)
 open_console();frame=page.evaluate('gm.functions.getFrameNum()');page.wait_for_timeout(500);assert page.evaluate('gm.functions.getFrameNum()')==frame
 run('input.stats.reduce((sum,n)=>sum+n,0)','318');run('1+2','3');run('const x=300; return x+18;','318','statements')
 run('({window:typeof window,fetch:typeof fetch,document:typeof document})','{\n  "window": "undefined",\n  "fetch": "undefined",\n  "document": "undefined"\n}')
 run('globalThis.persisted=42; return globalThis.persisted;','42','statements')
 run('typeof globalThis.persisted','"undefined"')
 run('input.stats.reduce((sum,n)=>sum+n,0)','318')
 assert transcript.locator(':scope > div').count()==7
 dialog.locator('[data-repl-mode]').select_option('statements');source.fill('while(true){}');source.press('Enter');dialog.locator('[data-repl-cancel]').click();page.wait_for_function('document.querySelector("[data-repl-transcript]").textContent.includes("Cancelled.")')
 page.screenshot(path=str(root/'build/site-repl-transcript.png'))
 source.press('Escape');page.wait_for_function('!document.querySelector("dialog.code-red-repl").open')
 page.wait_for_function('JSON.stringify(gameText())===JSON.stringify([164,162,169,255])');page.wait_for_timeout(2000)
 page.locator('canvas').screenshot(path=str(root/'build/site-repl-game-318.png'))
 assert page.evaluate('replies.some(r=>r.accepted&&r.args[2]===0&&r.args[3]===318)')
 # Additional natural game-menu return and reopen, without loading a fixture.
 page.evaluate('press(8)');page.wait_for_timeout(2500)
 page.locator('canvas').screenshot(path=str(root/'build/site-repl-natural-return.png'))
 page.evaluate('press(5)');page.evaluate('press(5)');page.evaluate('press(8)')
 page.evaluate("window.launch=setInterval(()=>{const f=gm.functions.getFrameNum();gm.simulateInput(0,8,f%60<8?1:0);if(document.querySelector('dialog.code-red-repl[open]')){clearInterval(launch);gm.simulateInput(0,8,0)}},4)")
 page.locator('dialog.code-red-repl[open]').wait_for(timeout=30000)
 run('1+2','3');source.press('Escape');page.wait_for_function('!document.querySelector("dialog.code-red-repl").open')
 print('Natural menu return/reopen PASS',flush=True)
 scenarios={}
 for mode in ('load','reset','hide'):
  open_console();source.fill('while(true){}');dialog.locator('[data-repl-mode]').select_option('statements');source.press('Enter')
  page.evaluate('''window.beforeEpoch=m._ejs_code_red_epoch();const ptr=m._malloc(36);if(!m._ejs_code_red_snapshot(ptr,36))throw Error('Expected current PC request');const v=new DataView(m.HEAPU8.buffer,ptr,36);window.pendingRequest={epoch:v.getUint32(12,true),id:v.getUint32(8,true)};m._free(ptr)''')
  if mode=='load':page.evaluate('gm.loadState(readyMenu)')
  elif mode=='reset':page.evaluate('gm.restart()')
  else:page.evaluate('Object.defineProperty(document,"hidden",{configurable:true,get:()=>true});document.dispatchEvent(new Event("visibilitychange"))')
  page.wait_for_function('!document.querySelector("dialog.code-red-repl").open')
  if mode!='hide':page.wait_for_function('m._ejs_code_red_epoch()!==beforeEpoch')
  else:page.evaluate('Object.defineProperty(document,"hidden",{configurable:true,get:()=>false});document.dispatchEvent(new Event("visibilitychange"))')
  page.wait_for_timeout(300);assert page.evaluate('m._ejs_code_red_reply(pendingRequest.epoch,pendingRequest.id,0,666)')==0;scenarios[mode]=True
 external=[u for u in requests if not u.startswith((origin,'blob:','data:'))]
 assert not errors,errors;assert not external,external
 workers=page.evaluate('workerCounts');assert workers['created']==workers['terminated'],workers
 result={'romSHA1':hashlib.sha1(rom).hexdigest(),'actualIntegratedSite':True,'playerAndRivalDOMNaming':True,'PCOp2OpensPausedScratchpad':True,'expressionsStatementsEditsTranscript':True,'freshSandboxNoWindowFetchDocument':True,'freshGlobalsEveryRun':True,'cancelInfiniteRun':True,'escapeReturns318InGame':True,'naturalPCMenuReturnAndReopen':True,'lifecycleNavigationViaPrivateMenuState':True,'lifecycleCancellationAndStaleReplyRejection':scenarios,'workers':workers,'externalRequests':external}
 (root/'build/site-repl.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));browser.close()
