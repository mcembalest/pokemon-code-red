#!/usr/bin/env python3
"""Download the pinned Code Red cores (core/release.json) into build/core/ and verify them."""
import hashlib, json, sys
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
pin = json.loads((ROOT / 'core/release.json').read_text())
out = ROOT / 'build/core'
out.mkdir(parents=True, exist_ok=True)
for name, sha in pin['files'].items():
    path = out / name
    if path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() == sha:
        continue
    url = f'https://github.com/{pin["repo"]}/releases/download/{pin["tag"]}/{name}'
    with urlopen(url, timeout=120) as response:
        data = response.read()
    digest = hashlib.sha256(data).hexdigest()
    if digest != sha:
        sys.exit(f'{url}: sha256 {digest} != pinned {sha}')
    path.write_bytes(data)
    print(f'downloaded {name}')
print(f'core {pin["tag"]} ready')
