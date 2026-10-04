from pathlib import Path
import re,sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from dev import ROOT,OUT,SOURCE,run
symbols=(SOURCE/'pokefirered.map').read_text()
address=re.search(r'(0x[0-9a-f]+)\s+gCodeRedNamingMailbox\b',symbols).group(1)
run(['gcc','-Wall','-Wextra',ROOT/'bridge/test-naming-native.c','-o',OUT/'test-naming-native','-lmgba'])
run([OUT/'test-naming-native',OUT/'code-red.gba',address,OUT/'native-naming-typed.ppm',re.search(r'(0x[0-9a-f]+)\s+gSaveBlock2Ptr\b',symbols).group(1)])
