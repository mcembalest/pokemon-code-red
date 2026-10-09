from pathlib import Path
import re, subprocess, sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
from dev import ROOT, OUT, SOURCE, run, environment
symbols = (SOURCE / 'pokefirered.map').read_text()
def symbol(name):
    return re.search(r'(0x[0-9a-f]+)\s+' + name + r'\b', symbols).group(1)
run(['gcc', ROOT / 'tests/native/pc.c', '-o', OUT / 'test-pc-native', '-lmgba'])
# A may first finish printing dialogue; allow sufficient settling and acknowledge twice.
# PC menus (patch 003): …, PokÉEG, Code, LOG OFF / TURN OFF — Code is three DOWNs from the top entry.
commands = []
def step(key, frames, label):
    commands.append(f'{key} {frames} {label}')
for key,n,label in [(2,8,'close-nes-1'),(2,8,'close-nes-2'),(32,80,'bedroom-left'),(64,64,'bedroom-up'),(32,32,'bedroom-pc-position'),(64,8,'bedroom-face'),(1,8,'bedroom-boot'),(0,150,'bedroom-dialogue'),(1,8,'bedroom-open'),(0,150,'bedroom-menu'),(128,8,'bedroom-code-down-1'),(128,8,'bedroom-code-down-2'),(128,8,'bedroom-code-down-3'),(1,8,'bedroom-code'),(0,150,'bedroom-prompt'),(1,8,'bedroom-ack-1'),(0,150,'bedroom-prompt-finished'),(1,8,'bedroom-ack-2'),(0,30,'bedroom-pending'),(2048,150,'bedroom-result'),(1,8,'bedroom-return'),(0,150,'bedroom-return-menu'),(2,8,'bedroom-off'),(1024,200,'center-fixture'),(32,64,'center-left'),(64,16,'center-up'),(1,8,'center-boot'),(0,150,'center-dialogue'),(1,8,'center-open'),(0,150,'center-menu'),(128,8,'center-code-down-1'),(128,8,'center-code-down-2'),(128,8,'center-code-down-3'),(1,8,'center-code'),(0,150,'center-prompt'),(1,8,'center-ack-1'),(0,150,'center-prompt-finished'),(1,8,'center-ack-2'),(0,30,'center-pending'),(2048,150,'center-result'),(1,8,'center-return'),(0,150,'center-return-menu')]:
    step(key,n,label)
# Exercise legacy menus after each Code result before leaving that PC.
def insert_after(label, sequence):
    index = next(i for i, command in enumerate(commands) if command.endswith(' ' + label)) + 1
    commands[index:index] = [f'{key} {frames} {name}' for key,frames,name in sequence]
insert_after('bedroom-return-menu', [(128,8,'bedroom-repeat-down-1'),(128,8,'bedroom-repeat-down-2'),(128,8,'bedroom-repeat-down-3'),(1,8,'bedroom-repeat-code'),(0,150,'bedroom-repeat-prompt'),(1,8,'bedroom-repeat-ack-1'),(0,150,'bedroom-repeat-prompt-finished'),(1,8,'bedroom-repeat-ack-2'),(0,30,'bedroom-repeat-pending'),(2048,150,'bedroom-repeat-result'),(1,8,'bedroom-repeat-return'),(0,150,'bedroom-repeat-return-menu')])
insert_after('bedroom-repeat-return-menu', [(1,8,'bedroom-storage-select'),(0,150,'bedroom-storage'),(2,8,'bedroom-storage-back'),(0,150,'bedroom-storage-return'),(128,8,'bedroom-mail-down'),(1,8,'bedroom-mail-select'),(0,150,'bedroom-mailbox'),(1,8,'bedroom-mail-ack'),(0,150,'bedroom-mail-return')])
insert_after('center-return-menu', [(128,8,'center-player-down'),(1,8,'center-player-select'),(0,150,'center-player-dialogue'),(1,8,'center-player-ack'),(0,150,'center-player-menu'),(1,8,'center-item-select'),(0,150,'center-item-storage'),(2,8,'center-item-back'),(0,150,'center-player-return'),(128,8,'center-mail-down'),(1,8,'center-mail-select'),(0,150,'center-mailbox'),(1,8,'center-mail-ack'),(0,150,'center-mail-return'),(2,8,'center-player-off'),(0,150,'center-services-return'),(1,8,'center-pokemon-select'),(0,150,'center-pokemon-dialogue'),(1,8,'center-pokemon-ack'),(0,150,'center-pokemon-opening'),(1,8,'center-pokemon-enter'),(0,180,'center-pokemon-storage')])
p=subprocess.run([OUT/'test-pc-native',OUT/'code-red.gba',OUT,symbol('gSaveBlock1Ptr'),symbol('gMain'),symbol('CB2_LoadMap'),symbol('gCodeRedMailbox')],input='\n'.join(commands)+'\n',capture_output=True,text=True,env=environment(),timeout=60)
print(p.stdout,end='');print(p.stderr,end='',file=sys.stderr)
assert p.returncode == 0
for label in ('bedroom-pending','bedroom-repeat-pending','center-pending'):
    assert re.search(r'^'+label+r'.*mailbox=1$',p.stdout,re.M)
for label in ('bedroom-result','bedroom-repeat-result','center-result'):
    assert re.search(r'^'+label+r'.*mailbox=0$',p.stdout,re.M)
print('Native bedroom and center Code request/reply passed; inspect result PPM captures.')
