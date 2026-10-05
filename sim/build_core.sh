#!/usr/bin/env bash
# Native (x86/arm) build of the same Code Red mGBA libretro core the browser uses:
# pinned EmulatorJS/mgba + core/mgba.patch + core/adapter.inc. Output: build/sim/mgba_libretro.so
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/.cache/sim-mgba"
REV=$(python3 -c "import json;print(json.load(open('$ROOT/core/sources.lock.json'))['mgba']['revision'])")
URL=$(python3 -c "import json;print(json.load(open('$ROOT/core/sources.lock.json'))['mgba']['url'])")
STAMP="$REV-$(cat "$ROOT/core/mgba.patch" "$ROOT/core/adapter.inc" | sha256sum | cut -c1-12)"
OUT="$ROOT/build/sim/mgba_libretro.so"
if [ -f "$OUT" ] && [ "$(cat "$OUT.stamp" 2>/dev/null)" = "$STAMP" ]; then echo "sim core ready"; exit 0; fi
if [ ! -d "$SRC/.git" ]; then git init -q "$SRC"; git -C "$SRC" remote add origin "$URL"; fi
if [ "$(git -C "$SRC" rev-parse HEAD 2>/dev/null || true)" != "$REV" ]; then
  git -C "$SRC" fetch -q --depth=1 origin "$REV"; git -C "$SRC" checkout -q --detach FETCH_HEAD
fi
git -C "$SRC" checkout -q -- . && git -C "$SRC" apply "$ROOT/core/mgba.patch"
cp "$ROOT/core/adapter.inc" "$SRC/src/platform/libretro/code_red_adapter.inc"
make -C "$SRC" -f Makefile.libretro -j"$(nproc)" CFLAGS_EXTRA=-O2 >/dev/null
mkdir -p "$(dirname "$OUT")" && cp "$SRC/mgba_libretro.so" "$OUT" && echo "$STAMP" > "$OUT.stamp"
echo "built $OUT"
