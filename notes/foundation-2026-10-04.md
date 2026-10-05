# Foundation rework — 2026-10-04 (dev/foundation)

Plan: foundation-plan.md. Status per item:

| § | item | status |
|---|---|---|
| 1 | ROM-independent core | done — `core/adapter.inc`, ABI 1 |
| 2 | saves survive builds | done — `player/src/saves.ts` |
| 3 | one home for the player | done — `player/`; site embeds release bundle |
| 4 | one dev command | done — `make dev` |
| 5 | CI | done — `ci.yml`, `core.yml` |
| 6 | generalize bridge | not started (protocols now in JS → cheap to add) |
| 7 | branch + doc cleanup | done — main merged; bridge/, web/, docs/ removed |

## Core
- exports: `ejs_cr_abi` `ejs_cr_epoch` `ejs_cr_ewram` `ejs_cr_ewram_size` `ejs_cr_iwram` `ejs_cr_iwram_size`
- upstream quirk found: mGBA libretro `retro_get_memory_size(RETRO_MEMORY_SYSTEM_RAM)` returns `GB_SIZE_WORKING_RAM` for every platform (`libretro.c` @ db6592a, ~l.2372) → adapter uses `GBA_SIZE_EWRAM`
- built by GitHub Actions (Google Storage, where emsdk lives, is blocked from agent sandboxes); 91 s
- release tag = hash of core inputs (`core/version.sh`) → `core-cb9fe1f909d0`; pinned in `core/release.json`
- native test: `core/test_native.py <mgba_libretro.so>` — real ROM to naming screen, writes via pointer, epoch on reset/load

## Player
- addresses: `build/rom/rom.json` ← `scripts/symbols.py` ← link map. Nothing hardcoded.
- protocols ported C → TS, same layouts/rules: `bridge/calc.ts` (36 B), `bridge/naming.ts` (60 B)
- stale-epoch handling moved from core hook to JS: request stamped with old epoch → state 4 (cancelled)
- saves: fixed `EJS_gameName` → stable `/data/saves/mGBA/Pokemon Code Red.srm`; flush every 10 s + on hide; backup `sav:<base sha1>` in IndexedDB
- old emulator-state saves from the PR 6 player are not migrated (pre-launch)

## Verified (Chromium, CI-built core, real ROM) — `player/tests/e2e.py`
- boot from base file → copy patch → SHA-1 check → core ABI 1
- intro → player + rival naming via DOM input
- calc op 1 → 318; op 2 scratchpad: game paused, `typeof fetch` = undefined, Escape → reply 318, game resumes
- request with stale epoch → cancelled
- Start → SAVE → "RED saved the game." → .sav (56,687 non-FF bytes) == IndexedDB backup
- rebuild ROM with a layout-shifting text edit (`0d16f8e9…` → `dc846c6a…`), same core, reload → title shows CONTINUE / RED → loads into bedroom
- delete emulator's .srm → reload → "Restored your save." from backup
- zero external requests, zero page errors
- headless mGBA: smoke (intro marker), `tests/native/naming.py`, `tests/native/pc.py` pass

## Site
- branch `feat/code-red-embed` off site main: page + `tools/fetch-code-red.mjs` + `bundle.lock.json`
- replaces PR 6 (which carried a copy of player + runner + 1 MB core + 764 KB patch)

## Not verified
- physical iOS / Android
- macOS toolchain path in README (written, not run)
