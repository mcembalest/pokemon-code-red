"""Prepare ignored pinned mGBA source, preserving changes. Does not build/download."""
from pathlib import Path
import json,re,subprocess
root=Path(__file__).resolve().parents[1]
source=root/'.cache/core-mgba'
lock=json.loads((root/'bridge/core-sources.lock.json').read_text())
revision=subprocess.check_output(['git','-C',source,'rev-parse','HEAD'],text=True).strip()
assert revision==lock['mgba']['revision'],'Unexpected source revision; preserve work and use pinned source.'
p=source/'src/platform/libretro/libretro.c'
text=p.read_text()
if '#include "code_red_adapter.inc"' not in text:
 assert not subprocess.check_output(['git','-C',source,'status','--porcelain'],text=True).strip(),'Dirty core checkout; do not overwrite.'
 text=text.replace('void retro_reset(void) {','static void code_red_core_invalidate(void);\n\nvoid retro_reset(void) {\n\tcode_red_core_invalidate();')
 text=text.replace('bool success = mCoreLoadStateNamed(core, vfm, SAVESTATE_RTC);','bool success = mCoreLoadStateNamed(core, vfm, SAVESTATE_RTC);\n\tcode_red_core_invalidate();')
 text+='\n#include "code_red_adapter.inc"\n'
 p.write_text(text)
link=source/'link.T'
exports='global: retro_*; ejs_code_red_epoch; ejs_code_red_snapshot; ejs_code_red_reply; ejs_code_red_text_snapshot; ejs_code_red_text_write;'
old_exports='global: retro_*; ejs_code_red_epoch; ejs_code_red_snapshot; ejs_code_red_reply;'
linktext=link.read_text()
if exports not in linktext:
 link.write_text(linktext.replace(old_exports,exports) if old_exports in linktext else linktext.replace('global: retro_*;',exports))
folder=p.parent
for name,filename in [('mailbox.h','code_red_mailbox.h'),('mailbox.c','code_red_mailbox.c'),('core-adapter.inc','code_red_adapter.inc'),('naming-transport.h','code_red_naming_transport.h'),('naming-transport.c','code_red_naming_transport.c')]:
 adapt=lambda value:value.replace('#include "mailbox.h"','#include "code_red_mailbox.h"').replace('#include "naming-transport.h"','#include "code_red_naming_transport.h"')
 text=adapt((root/'bridge'/name).read_text())
 target=folder/filename
 if target.exists() and target.read_text()!=text:
  previous=subprocess.run(['git','-C',root,'show',f'HEAD:bridge/{name}'],capture_output=True,text=True)
  if previous.returncode or target.read_text()!=adapt(previous.stdout):
   raise SystemExit(f'Preserve edited core file {target}; reconcile manually.')
 target.write_text(text)
maptext=(root/'.cache/pokefirered/pokefirered.map').read_text()
address=re.search(r'(0x[0-9a-f]+)\s+gCodeRedMailbox',maptext).group(1)
assert 0x02000000<=int(address,16)<=0x02040000-36
naming=re.search(r'(0x[0-9a-f]+)\s+gCodeRedNamingMailbox',maptext)
assert naming,'Build the naming ROM before preparing its fixed-address core.'
naming_address=naming.group(1)
assert 0x02000000<=int(naming_address,16)<=0x02040000-60
assert int(address,16)+36<=int(naming_address,16) or int(naming_address,16)+60<=int(address,16),'Mailbox ranges overlap.'
(folder/'code_red_address.h').write_text(f'#define CODE_RED_MAILBOX_ADDRESS {address}\n#define CODE_RED_NAMING_MAILBOX_ADDRESS {naming_address}\n')
print(f'Prepared custom-core source at {revision}, mailbox {address}, naming {naming_address}; NOT BUILT.')
