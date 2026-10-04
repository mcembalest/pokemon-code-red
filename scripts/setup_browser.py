#!/usr/bin/env python3
"""Fetch integrity-pinned official emulator packages; no npm scripts or ROM assets."""
import base64
import hashlib
import io
import json
from pathlib import Path
import shutil
import tarfile
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.cache/browser'
DATA = CACHE / 'data'

def setup():
    lock = json.loads((ROOT / 'browser.lock.json').read_text())
    stamp = CACHE / 'installed.json'
    installed = {'packages': lock, 'local_update_check_disabled': 1}
    if stamp.exists() and json.loads(stamp.read_text()) == installed and (DATA / 'cores/mgba-wasm.data').exists():
        print('Pinned browser emulator ready.'); return
    CACHE.mkdir(parents=True, exist_ok=True)
    for key, info in lock.items():
        archive = CACHE / (key + '.tgz')
        if not archive.exists():
            with urlopen(info['url'], timeout=60) as response: archive.write_bytes(response.read())
        data = archive.read_bytes()
        expected = info['integrity'].removeprefix('sha512-')
        actual = base64.b64encode(hashlib.sha512(data).digest()).decode()
        if actual != expected: raise SystemExit(f'{key}: integrity mismatch; remove {archive} and retry.')
        dest = CACHE / key
        dest.mkdir(exist_ok=True)
        # Extract regular files only, reject links and paths escaping the package.
        with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as tar:
            for member in tar.getmembers():
                path = Path(member.name)
                if path.is_absolute() or '..' in path.parts or path.parts[0] != 'package':
                    raise SystemExit('Unsafe package path')
                if member.isdir(): continue
                if not member.isfile(): raise SystemExit('Unexpected package link/special file')
                file = dest / path
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_bytes(tar.extractfile(member).read())
    shutil.copytree(CACHE / 'frontend/package/data', DATA, dirs_exist_ok=True)
    for file in (CACHE / 'gba_core/package').glob('*.data'):
        shutil.copyfile(file, DATA / 'cores' / file.name)
    reports = DATA / 'cores/reports'
    reports.mkdir(exist_ok=True)
    shutil.copyfile(CACHE / 'gba_core/package/reports/mgba.json', reports / 'mgba.json')
    emulator = DATA / 'src/emulator.js'
    source = emulator.read_text()
    check = 'if (this.debug || (window.location && ["localhost", "127.0.0.1"].includes(location.hostname))) this.checkForUpdates();'
    if source.count(check) != 1: raise SystemExit('Pinned optional update check changed unexpectedly')
    emulator.write_text(source.replace(check, '// Code Red: pinned offline runtime; optional CDN update check disabled.'))
    stamp.write_text(json.dumps(installed, indent=2) + '\n')
    print('Integrity-verified browser emulator installed locally; no CDN needed.')

if __name__ == '__main__': setup()
