#!/usr/bin/env python3
"""Make build/rom/: the per-build files the player needs.

  rom.json         base/rom SHA-1, patch file name, RAM symbols
  code-red.copy.bin  gzip CRCP1 copy patch: offsets into the player's own
                   FireRed file, no ROM bytes (scripts/make_copy_patch.py)

Needs a lawfully obtained FireRed USA v1.0 dump at local/baserom.gba.
"""
import gzip, hashlib, json, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'local/baserom.gba'
ROM = ROOT / 'build/code-red.gba'
OUT = ROOT / 'build/rom'
BASE_SHA1 = '41cb23d8dccc8ebd7c649cd8fbb58eeace6e2fdc'

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
    raw = ROOT / 'build/code-red.copy.raw'
    subprocess.run([sys.executable, ROOT / 'scripts/make_copy_patch.py', BASE, ROM, raw], check=True)
    patch = 'code-red.copy.bin'
    (OUT / patch).write_bytes(gzip.compress(raw.read_bytes(), mtime=0))
    raw.unlink()
    (OUT / 'rom.json').write_text(json.dumps({
        'base_sha1': BASE_SHA1, 'rom_sha1': rom_sha1, 'patch': patch,
        'symbols': symbols['symbols'],
    }, indent=2) + '\n')
    print(f'wrote {OUT.relative_to(ROOT)}/ for ROM {rom_sha1[:12]}')

if __name__ == '__main__':
    main()
