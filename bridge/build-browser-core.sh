#!/usr/bin/env bash
# For an already authorized SDK environment only. No downloads or git pulls.
set -euo pipefail
cd "$(dirname "$0")/.."
for tool in emcc emmake 7z make python3; do
  command -v "$tool" >/dev/null || { echo "Missing $tool; use an authorized SDK build environment." >&2; exit 1; }
done
emcc --version | head -1 | grep -F '3.1.74' >/dev/null || { echo 'Expected Emscripten 3.1.74.' >&2; exit 1; }
python3 - <<'PY'
from pathlib import Path
import json,subprocess
root=Path.cwd();lock=json.loads((root/'bridge/core-sources.lock.json').read_text())
for name in ('mgba','retroarch','build'):
 path=root/'.cache'/f'core-{name}'
 sha=subprocess.check_output(['git','-C',path,'rev-parse','HEAD'],text=True).strip()
 if sha!=lock[name]['revision']:raise SystemExit(f'Wrong {name} revision; preserve edits and fetch the pinned source separately.')
p=root/'.cache/core-retroarch/Makefile.emulatorjs'
old_marker='\n# Code Red narrow mailbox exports\nEXPORTED_FUNCTIONS := $(EXPORTED_FUNCTIONS),_ejs_code_red_epoch,_ejs_code_red_snapshot,_ejs_code_red_reply\n'
marker='\n# Code Red narrow mailbox exports\nEXPORTED_FUNCTIONS := $(EXPORTED_FUNCTIONS),_ejs_code_red_epoch,_ejs_code_red_snapshot,_ejs_code_red_reply,_ejs_code_red_text_snapshot,_ejs_code_red_text_write\n'
text=p.read_text()
if marker not in text:
 if old_marker in text:
  p.write_text(text.replace(old_marker,marker))
 else:
  if subprocess.check_output(['git','-C',p.parent,'status','--porcelain'],text=True).strip():raise SystemExit('Dirty RetroArch source; preserve edits and reconcile manually.')
  p.write_text(text+marker)
PY
python3 bridge/prepare-core.py
(cd .cache/core-mgba && emmake make -f Makefile.libretro clean && emmake make -f Makefile.libretro platform=emscripten -j2)
cp .cache/core-mgba/mgba_libretro_emscripten.bc .cache/core-retroarch/emulatorjs/
(cd .cache/core-retroarch/emulatorjs && emmake ./build-emulatorjs.sh --clean)
mkdir -p .cache/mailbox-package
python3 - <<'PY'
from pathlib import Path
import json,re
root=Path.cwd();temp=root/'.cache/mailbox-package'
cores=json.loads((root/'.cache/core-build/cores.json').read_text())
core=next(c for c in cores if c['name']=='mgba')
(temp/'core.json').write_text(json.dumps(core))
(temp/'license.txt').write_text((root/'.cache/core-mgba/LICENSE').read_text())
manifest=json.loads((root/'build/manifest.json').read_text())
(temp/'build.json').write_text((root/'.cache/core-build/build.json').read_text())
addresses=(root/'.cache/core-mgba/src/platform/libretro/code_red_address.h').read_text()
mailboxes={key:{'address':re.search(r'#define '+name+r' (0x[0-9a-f]+)',addresses).group(1),'bytes':size} for key,name,size in [('code','CODE_RED_MAILBOX_ADDRESS',36),('naming','CODE_RED_NAMING_MAILBOX_ADDRESS',60)]}
(temp/'code-red.json').write_text(json.dumps({'sources':json.loads((root/'bridge/core-sources.lock.json').read_text()),'rom':manifest,'status':'built; browser validation recorded separately','mailboxes':mailboxes},indent=2))
PY
(cd .cache/mailbox-package && 7z a -t7z ../EmulatorJS/data/cores/mgba-wasm.data core.json license.txt build.json code-red.json)
mkdir -p build/browser-core
cp .cache/EmulatorJS/data/cores/mgba-wasm.data build/browser-core/
sha256sum build/browser-core/mgba-wasm.data
printf '%s\n' 'Built custom core; validate boot/exports/mailbox/lifecycle in browser before site integration.'
