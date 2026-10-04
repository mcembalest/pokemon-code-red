#!/usr/bin/env python3
"""Small, pinned FireRed development loop. Never commits or publishes."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.cache'
SOURCE = CACHE / 'pokefirered'
OUT = ROOT / 'build'
BASE_SHA1 = '41cb23d8dccc8ebd7c649cd8fbb58eeace6e2fdc'

def environment():
    env = os.environ.copy()
    sysroot = CACHE / 'sysroot'
    env['PATH'] = f'{sysroot}/usr/bin:' + env['PATH']
    lib = str(sysroot / 'usr/lib/x86_64-linux-gnu')
    env['LD_LIBRARY_PATH'] = os.pathsep.join(filter(None, (lib, env.get('LD_LIBRARY_PATH'))))
    env['CPATH'] = os.pathsep.join(filter(None, (str(sysroot / 'usr/include'), env.get('CPATH'))))
    env['LIBRARY_PATH'] = os.pathsep.join(filter(None, (lib, env.get('LIBRARY_PATH'))))
    env['PKG_CONFIG_PATH'] = os.pathsep.join(filter(None, (lib + '/pkgconfig', env.get('PKG_CONFIG_PATH'))))
    env['PKG_CONFIG_SYSROOT_DIR'] = str(sysroot) if sysroot.exists() else env.get('PKG_CONFIG_SYSROOT_DIR', '/')
    return env

def run(args, cwd=ROOT):
    subprocess.run([str(x) for x in args], cwd=cwd, env=environment(), check=True)

def bootstrap():
    CACHE.mkdir(exist_ok=True)
    for name, info in json.loads((ROOT / 'upstream.lock.json').read_text()).items():
        dest = CACHE / name
        if not dest.exists():
            run(['git', 'init', dest])
            run(['git', 'remote', 'add', 'origin', info['url']], dest)
            run(['git', 'fetch', '--depth=1', 'origin', info['revision']], dest)
            run(['git', 'checkout', '--detach', 'FETCH_HEAD'], dest)
        actual = subprocess.check_output(['git', '-C', str(dest), 'rev-parse', 'HEAD'], text=True).strip()
        if actual != info['revision']:
            raise SystemExit(f'{name}: expected {info["revision"]}, got {actual}; preserve edits and recreate checkout.')
    for tool in ('gcc', 'g++', 'make', 'arm-none-eabi-as', 'arm-none-eabi-ar'):
        if not shutil.which(tool, path=environment()['PATH']):
            raise SystemExit(f'Missing {tool}. See README prerequisites, then rerun make setup.')
    if not (SOURCE / 'tools/agbcc/bin/agbcc').exists():
        run(['sh', 'build.sh'], CACHE / 'agbcc')
        run(['sh', 'install.sh', SOURCE], CACHE / 'agbcc')
    print('Pinned source and compiler ready.')

def apply_patches():
    for patch in sorted((ROOT / 'patches').glob('*.patch')):
        reverse = subprocess.run(['git', 'apply', '--reverse', '--check', str(patch)], cwd=SOURCE, capture_output=True)
        if reverse.returncode == 0:
            continue
        run(['git', 'apply', '--check', patch], SOURCE)
        run(['git', 'apply', patch], SOURCE)

def build(baseline=False):
    if not SOURCE.exists():
        raise SystemExit('Run make setup first.')
    if baseline:
        dirty = subprocess.check_output(['git', 'status', '--porcelain'], cwd=SOURCE, text=True)
        if dirty:
            raise SystemExit('Baseline requires a clean upstream checkout. Run make baseline BEFORE make build; never discard source edits.')
    else:
        apply_patches()
    OUT.mkdir(exist_ok=True)
    run(['make', '-j' + str(min(os.cpu_count() or 2, 8))], SOURCE)
    data = (SOURCE / 'pokefirered.gba').read_bytes()
    digest = hashlib.sha1(data).hexdigest()
    if baseline and digest != BASE_SHA1:
        raise SystemExit(f'Baseline mismatch: {digest}')
    target = OUT / ('baseline.gba' if baseline else 'code-red.gba')
    target.write_bytes(data)
    manifest = {'file': target.name, 'sha1': digest, 'bytes': len(data), 'baseline': baseline,
                'upstream': json.loads((ROOT / 'upstream.lock.json').read_text())['pokefirered']['revision'],
                'patches': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((ROOT / 'patches').glob('*.patch'))} if not baseline else {}}
    (OUT / ('baseline.json' if baseline else 'manifest.json')).write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps(manifest, indent=2))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['setup', 'baseline', 'build', 'export'])
    args = parser.parse_args()
    if args.command == 'setup': bootstrap()
    elif args.command in ('build', 'baseline'): build(args.command == 'baseline')
    else:
        OUT.mkdir(exist_ok=True)
        run(['git', 'diff', '--binary', '--output=' + str(ROOT / 'patches/001-code-red-intro.patch'), '--', 'data/text/new_game_intro.inc'], SOURCE)
        print('Exported intro edits. For other files, create a separate scoped patch with git diff --binary.')

if __name__ == '__main__':
    try: main()
    except subprocess.CalledProcessError as error: sys.exit(error.returncode)
