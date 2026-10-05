#!/usr/bin/env bash
# Build the Code Red mGBA core for EmulatorJS from pinned sources.
#   requires: emsdk 3.1.74 activated (emcc on PATH), git, make, python3, 7z
#   output:   build/core/code-red-mgba-wasm.data (+ .sha256)
# The core is ROM-agnostic (core/adapter.inc); rebuild only when the
# adapter, patches or pinned sources change.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${WORK:-$ROOT/.cache/core}"
OUT="$ROOT/build/core"
LOCK="$ROOT/core/sources.lock.json"
lock() { python3 -c "import json,sys;print(json.load(open('$LOCK'))[sys.argv[1]][sys.argv[2]])" "$1" "$2"; }

emcc --version | head -1 | grep -qF "$(lock emsdk sdk)" || { echo "need emcc $(lock emsdk sdk)" >&2; exit 1; }
command -v 7z >/dev/null || { echo "need 7z" >&2; exit 1; }

fetch() { # name dir
  local dir="$WORK/$2" url rev; url="$(lock "$1" url)"; rev="$(lock "$1" revision)"
  if [ ! -d "$dir/.git" ]; then
    git init -q "$dir"; git -C "$dir" remote add origin "$url"
  fi
  if [ "$(git -C "$dir" rev-parse HEAD 2>/dev/null || true)" != "$rev" ]; then
    git -C "$dir" fetch -q --depth=1 origin "$rev"; git -C "$dir" checkout -q --detach FETCH_HEAD
  fi
  git -C "$dir" reset -q --hard "$rev"; git -C "$dir" clean -qfdx
}
mkdir -p "$WORK" "$OUT"
fetch mgba mgba
fetch retroarch RetroArch
fetch build build

git -C "$WORK/mgba" apply "$ROOT/core/mgba.patch"
cp "$ROOT/core/adapter.inc" "$WORK/mgba/src/platform/libretro/code_red_adapter.inc"
git -C "$WORK/RetroArch" apply "$ROOT/core/retroarch.patch"

(cd "$WORK/mgba" && emmake make -f Makefile.libretro platform=emscripten -j"$(nproc)")
cp "$WORK/mgba/mgba_libretro_emscripten.bc" "$WORK/RetroArch/emulatorjs/"
rm -rf "$WORK/EmulatorJS"
(cd "$WORK/RetroArch/emulatorjs" && emmake ./build-emulatorjs.sh --clean)

PKG="$WORK/package"; rm -rf "$PKG"; mkdir -p "$PKG"
python3 - "$WORK" "$PKG" "$LOCK" "$ROOT/core/adapter.inc" <<'PY'
import json, sys, hashlib, pathlib
work, pkg, lock, adapter = map(pathlib.Path, sys.argv[1:])
cores = json.loads((work/'build/cores.json').read_text())
(pkg/'core.json').write_text(json.dumps(next(c for c in cores if c['name'] == 'mgba')))
(pkg/'build.json').write_text((work/'build/build.json').read_text())
(pkg/'license.txt').write_text((work/'mgba/LICENSE').read_text())
(pkg/'code-red.json').write_text(json.dumps({
    'abi': 1,
    'exports': ['ejs_cr_abi', 'ejs_cr_epoch', 'ejs_cr_ewram', 'ejs_cr_ewram_size'],
    'sources': json.loads(lock.read_text()),
    'adapter_sha256': hashlib.sha256(adapter.read_bytes()).hexdigest(),
}, indent=2))
PY
DATA="$WORK/EmulatorJS/data/cores/mgba-wasm.data"
(cd "$PKG" && 7z a -t7z "$DATA" core.json license.txt build.json code-red.json >/dev/null)
cp "$DATA" "$OUT/code-red-mgba-wasm.data"
(cd "$OUT" && sha256sum code-red-mgba-wasm.data | tee code-red-mgba-wasm.data.sha256)
