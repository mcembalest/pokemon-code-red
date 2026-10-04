"""Actual intro/naming ROM with fixed browser transport; serve locally first."""
from pathlib import Path
import hashlib, json, shutil
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
 page=browser.new_page();errors=[];requests=[]
 page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:requests.append(r.url))
 page.goto('http://127.0.0.1:8000/bridge/test');page.wait_for_function('window.ready',timeout=60000)
 page.evaluate('''window.gm=EJS_emulator.gameManager;window.m=gm.Module;window.ptr=m._malloc(60);window.input=m._malloc(16);
 window.snap=()=>{if(!m._ejs_code_red_text_snapshot(ptr,60))return null;const a=m.HEAPU8.slice(ptr,ptr+60),v=new DataView(a.buffer);return {session:v.getUint32(8,true),sequence:v.getUint32(16,true),ack:v.getUint32(20,true),action:a[24],status:a[26],max:a[7],text:new TextDecoder().decode(a.slice(28,28+a[27]))}};
 window.write=(epoch,session,seq,action,text)=>{const b=new TextEncoder().encode(text);m.HEAPU8.set(b,input);return m._ejs_code_red_text_write(epoch,session,seq,action,input,b.length)};
 window.named=false;gm.functions.setFastForwardRatio(10);gm.functions.toggleFastForward(1);
 window.driver=setInterval(()=>{const f=gm.functions.getFrameNum();gm.simulateInput(0,3,f>=600&&f<615?1:0);gm.simulateInput(0,8,f>630&&f%60<8?1:0);if(snap()){clearInterval(driver);gm.simulateInput(0,3,0);gm.simulateInput(0,8,0);gm.functions.toggleFastForward(0);named=true}},4);''')
 page.wait_for_function('named',timeout=120000)
 page.evaluate('window.session=snap().session;window.epoch=m._ejs_code_red_epoch()')
 assert page.evaluate('snap().max')==7
 assert page.evaluate('''()=>[m._ejs_code_red_text_snapshot(ptr,59),m._ejs_code_red_text_snapshot(ptr,61),m._ejs_code_red_text_snapshot(0,60),m._ejs_code_red_text_snapshot(m.HEAPU8.length-20,60),m._ejs_code_red_text_write(epoch,session,1,1,m.HEAPU8.length-1,7)]''')==[0]*5
 assert page.evaluate('write(epoch,session,1,1,"Ab 12?!")')==1
 page.wait_for_function('snap()?.ack===1&&snap().text==="Ab 12?!"')
 page.locator('canvas').screenshot(path=str(root/'build/browser-naming-mixed.png'))
 assert page.evaluate('write(epoch,session,2,1,"Ab 1")')==1
 page.wait_for_function('snap()?.ack===2&&snap().text==="Ab 1"')
 assert page.evaluate(r'''()=>[write(epoch+1,session,3,1,'STALE'),write(epoch,session+1,3,1,'STALE'),write(epoch,session,2,1,'REPLAY'),write(epoch,session,3,1,'TOO LONG'),write(epoch,session,3,1,'{bad}'),write(epoch,session,3,1,'\n'),write(epoch,session,3,1,'é')]''')==[0]*7
 assert page.evaluate('snap().text')=='Ab 1'
 assert page.evaluate('''()=>[write(epoch,session,3,1,'OLD'),write(epoch,session,4,1,'New')]''')==[1,1]
 page.wait_for_function('snap()?.ack===4&&snap().text==="New"')
 page.evaluate('''write(epoch,session,5,1,'QUEUED');window.pendingState=gm.getState();window.oldEpoch=epoch;gm.loadState(pendingState)''')
 page.wait_for_function('m._ejs_code_red_epoch()!==oldEpoch')
 assert page.evaluate('write(oldEpoch,session,6,1,"STALE")')==0
 assert page.evaluate('snap().action')==0
 page.evaluate('epoch=m._ejs_code_red_epoch()')
 assert page.evaluate('write(epoch,session,6,1,"Ab 12?!")')==1
 page.wait_for_function('snap()?.ack===6&&snap().text==="Ab 12?!"')
 assert page.evaluate('write(epoch,session,7,2,"")')==1
 page.wait_for_function('snap()===null')
 assert page.evaluate('write(epoch,session,8,1,"AFTER")')==0
 page.evaluate('controller.dispose();m._free(ptr);m._free(input)')
 external=[u for u in requests if not u.startswith(('http://127.0.0.1:8000/','blob:','data:'))]
 assert not external,external;assert not errors,errors
 result={'romSHA1':hashlib.sha1((root/'build/code-red.gba').read_bytes()).hexdigest(),'coreSHA256':hashlib.sha256((root/'build/browser-core/mgba-wasm.data').read_bytes()).hexdigest(),'actualIntroNaming':True,'mixedASCII':True,'shorterReplacement':True,'pointerCapacityBounds':True,'epochSessionReplayCharacterLengthRejections':True,'coalescedInput':True,'pendingLoadInvalidation':True,'originalConfirmExit':True,'externalRequests':external}
 (root/'build/browser-naming.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));browser.close()
