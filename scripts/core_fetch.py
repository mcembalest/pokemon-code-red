#!/usr/bin/env python3
"""Download the pinned Code Red core (core/release.json) into build/core/ and verify it."""
import hashlib, json, sys
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
pin = json.loads((ROOT / 'core/release.json').read_text())
out = ROOT / 'build/core/code-red-mgba-wasm.data'
if out.exists() and hashlib.sha256(out.read_bytes()).hexdigest() == pin['sha256']:
    print(f'core {pin["tag"]} ready'); sys.exit(0)
url = f'https://github.com/{pin["repo"]}/releases/download/{pin["tag"]}/code-red-mgba-wasm.data'
with urlopen(url, timeout=120) as response:
    data = response.read()
digest = hashlib.sha256(data).hexdigest()
if digest != pin['sha256']:
    sys.exit(f'{url}: sha256 {digest} != pinned {pin["sha256"]}')
out.parent.mkdir(parents=True, exist_ok=True)
out.write_bytes(data)
print(f'core {pin["tag"]} downloaded and verified')
