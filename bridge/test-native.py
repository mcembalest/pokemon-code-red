from pathlib import Path
import json,re,subprocess,sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from dev import ROOT,OUT,SOURCE,run,environment
text=(SOURCE/'pokefirered.map').read_text()
address=re.search(r'(0x[0-9a-f]+)\s+gCodeRedMailbox',text).group(1)
run(['gcc','-Wall','-Wextra',ROOT/'bridge/native-demo.c',ROOT/'bridge/mailbox.c','-o',OUT/'mailbox-demo','-lmgba'])
summaries=[]
for mode in ('success','error','timeout','cancel','restore','reset'):
 p=subprocess.Popen([OUT/'mailbox-demo',OUT/'code-red.gba',address,OUT/f'mailbox-{mode}.ppm',mode],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,env=environment())
 events=[]
 for line in p.stdout:
  event=json.loads(line);events.append(event)
  if event['event']=='request' and mode in ('success','error'):
   result=subprocess.run(['node',ROOT/'bridge/calculate.mjs',json.dumps({'stats':event['stats']}),mode],capture_output=True,text=True,timeout=5)
   if mode=='success':
    assert result.returncode==0 and result.stdout.strip()=='318'
    p.stdin.write('0 318\n')
   else:
    assert result.returncode!=0
    p.stdin.write('1 0\n')
   p.stdin.flush()
 assert p.wait(timeout=5)==0
 count=2 if mode=='success' else 1
 assert len([e for e in events if e['event']=='request'])==count
 assert len([e for e in events if e['event']=='displayed'])==count
 summaries.append({'mode':mode,'events':events})
print(json.dumps({'native_rom_to_quickjs_to_rom':True,'scenarios':summaries,'browser_bridge_verified':False},indent=2))
