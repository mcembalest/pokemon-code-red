#!/usr/bin/env python3
"""Make build/rom/: the per-build files the player needs.

  rom.json         base/rom SHA-1, patch file name, RAM symbols
  code-red.copy.bin  gzip CRCP1 copy patch: offsets into the player's own
                   FireRed file, no ROM bytes (scripts/make_copy_patch.py)

Needs a lawfully obtained FireRed USA v1.0 dump at local/baserom.gba. With FireRed USA v1.1 (Rev 1) at
local/baserom-rev1.gba (CI builds it from the decomp), a second patch lets players bring either file.
"""
import gzip, hashlib, json, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'local/baserom.gba'
ROM = ROOT / 'build/code-red.gba'
OUT = ROOT / 'build/rom'
BASE_SHA1 = '41cb23d8dccc8ebd7c649cd8fbb58eeace6e2fdc'
REV1 = ROOT / 'local/baserom-rev1.gba'
REV1_SHA1 = 'dd5945db9b930750cb39d00c84da8571feebf417'

def main():
    if not BASE.exists():
        sys.exit(f'missing {BASE.relative_to(ROOT)}: FireRed USA v1.0 (SHA-1 {BASE_SHA1})')
    if hashlib.sha1(BASE.read_bytes()).hexdigest() != BASE_SHA1:
        sys.exit(f'{BASE.relative_to(ROOT)} is not FireRed USA v1.0')
    subprocess.run([sys.executable, ROOT / 'scripts/symbols.py'], check=True)
    rom_sha1 = hashlib.sha1(ROM.read_bytes()).hexdigest()
    symbols = json.loads((ROOT / 'build/symbols.json').read_text())
    if symbols['rom_sha1'] != rom_sha1:
        sys.exit('build/symbols.json is stale; run make build')
    OUT.mkdir(parents=True, exist_ok=True)
    bases = []
    for base, sha, patch in ((BASE, BASE_SHA1, 'code-red.copy.bin'), (REV1, REV1_SHA1, 'code-red.rev1.copy.bin')):
        if base == REV1 and not (REV1.exists() and hashlib.sha1(REV1.read_bytes()).hexdigest() == REV1_SHA1):
            (OUT / patch).unlink(missing_ok=True)
            continue
        raw = ROOT / 'build/code-red.copy.raw'
        subprocess.run([sys.executable, ROOT / 'scripts/make_copy_patch.py', base, ROM, raw], check=True)
        (OUT / patch).write_bytes(gzip.compress(raw.read_bytes(), mtime=0))
        raw.unlink()
        bases.append({'sha1': sha, 'patch': patch})
    (OUT / 'rom.json').write_text(json.dumps({
        'base_sha1': BASE_SHA1, 'rom_sha1': rom_sha1, 'patch': 'code-red.copy.bin', 'bases': bases,
        'symbols': symbols['symbols'],
    }, indent=2) + '\n')
    print(f'wrote {OUT.relative_to(ROOT)}/ for ROM {rom_sha1[:12]} (bases: {", ".join("v1.1" if b["sha1"] == REV1_SHA1 else "v1.0" for b in bases)})')

if __name__ == '__main__':
    main()
