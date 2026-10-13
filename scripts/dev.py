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
REV1_SHA1 = 'dd5945db9b930750cb39d00c84da8571feebf417'

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

APPLIED = CACHE / 'applied.json'  # what the last apply left in the tree (fingerprint + files it added)


def added_files() -> list[str]:
    """New files the patches add (they are untracked in the upstream checkout)."""
    out = set()
    for patch in sorted((ROOT / 'patches').glob('*.patch')):
        for block in patch.read_text().split('diff --git a/')[1:]:
            if '\nnew file mode' in block.split('\n@@', 1)[0]:
                out.add(block.split(' b/', 1)[1].split('\n', 1)[0])
    return sorted(out)


def tree_fingerprint(added: list[str]) -> str:
    """The tree's edits: the tracked diff plus the files the patches added."""
    h = hashlib.sha256(subprocess.run(['git', 'diff', '--binary'], cwd=SOURCE, capture_output=True, check=True).stdout)
    for f in added:
        p = SOURCE / f
        h.update(f.encode() + (p.read_bytes() if p.exists() else b'-'))
    return h.hexdigest()


def reset_tree(added: list[str]) -> None:
    """Back to the pinned upstream: tracked files restored, the files the last apply added removed."""
    run(['git', 'reset', '-q'], SOURCE)
    run(['git', 'checkout', '-q', '--', '.'], SOURCE)
    for f in added:
        (SOURCE / f).unlink(missing_ok=True)


def apply_patches():
    """Apply the patches that are not in the tree yet. When the tree holds another patch set (you switched branches)
    and nothing in it was edited by hand since that set was applied, it is reset and this set applied from scratch;
    hand edits are never discarded: `make patches` first."""
    patches = sorted((ROOT / 'patches').glob('*.patch'))
    def state(patch):
        if subprocess.run(['git', 'apply', '--reverse', '--check', str(patch)], cwd=SOURCE, capture_output=True).returncode == 0:
            return 'applied'
        return 'clean' if subprocess.run(['git', 'apply', '--check', str(patch)], cwd=SOURCE, capture_output=True).returncode == 0 else 'conflict'
    if any(state(p) == 'conflict' for p in patches):
        last = json.loads(APPLIED.read_text()) if APPLIED.exists() else None
        if not last or tree_fingerprint(last['added']) != last['fingerprint']:
            raise SystemExit('The decomp tree holds edits that are not in these patches. Run `make patches` (or commit them on '
                             'their branch) first; nothing was changed.')
        print('The decomp tree holds another patch set (unchanged since it was applied): resetting it to this branch\'s patches.')
        reset_tree(last['added'])
    for patch in patches:
        if state(patch) == 'applied':
            continue
        run(['git', 'apply', '--check', patch], SOURCE)
        run(['git', 'apply', patch], SOURCE)
    added = added_files()
    APPLIED.write_text(json.dumps({'fingerprint': tree_fingerprint(added), 'added': added}))

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
    if baseline:  # FireRed v1.1 (Rev 1) too: many players' files are Rev 1, and it gets its own copy patch
        run(['make', 'firered_rev1', '-j' + str(min(os.cpu_count() or 2, 8))], SOURCE)
        rev1 = (SOURCE / 'pokefirered_rev1.gba').read_bytes()
        if hashlib.sha1(rev1).hexdigest() != REV1_SHA1:
            raise SystemExit(f'Rev 1 baseline mismatch: {hashlib.sha1(rev1).hexdigest()}')
        (OUT / 'baseline-rev1.gba').write_bytes(rev1)
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
