# Foundation plan — proposal

Goal: change game or player code → see it in the real player in seconds; deploys never break saves; core never rebuilt for game changes.

Order matters: 1 + 2 unblock everything else.

## 1. ROM-independent core (rebuild once, then rarely)
- today: core knows mailbox addresses (fragility-audit §1)
- change: core exports only generic, ROM-agnostic primitives
  - `ejs_cr_ewram()` → pointer to EWRAM in WASM heap
    - mGBA libretro already has it: `retro_get_memory_data(RETRO_MEMORY_SYSTEM_RAM)` → `((struct GBA*)core->board)->memory.wram` (EmulatorJS/mgba `db6592a` `src/platform/libretro/libretro.c:2302-2310`)
  - `ejs_cr_epoch()` → bumps on reset / state load (keep existing hook idea)
- stock core can't do this: stock `mgba_libretro.js` 4.2.3 exports no memory read (checked export list; only `_set_cheat` writes)
- JS finds the mailbox itself:
  - option A: scan EWRAM for magic `CRD2` once per epoch (256 KiB scan, trivial)
  - option B: build emits `build/symbols.json` from `pokefirered.map`; player loads it alongside copy patch
  - do both: B primary, A as check
- all protocol parsing moves C → JS (easier to test, no rebuild)
- trust boundary unchanged: QuickJS guest still sees only JSON; only trusted player code touches EWRAM

## 2. Saves that survive builds
- persist SRAM (.sav) not emulator states
  - EmulatorJS: `gameManager.getSaveFile()`, write to `getSaveFilePath()` + `loadSaveFiles()`
  - key: `sav:${BASE_SHA1}:${slot}` — not ROM hash
- autosave .sav on in-game save (poll SRAM dirty / `saveSaveFiles` event), plus on pagehide
- keep emulator states only as optional, build-scoped quick-resume
- Code Red data (browser-side) keyed by save ID in SaveBlock2 slack (memory-budget.md)
- export/import = one file: `.sav` + Code Red JSON
- rule: never change existing save struct layout without a migration

## 3. One home for the player
- move player (`src/things/pokemon-code-red/*`, `tools/code-red-runner/*`, prepare scripts) into G: as `player/` (Vite or plain esbuild, TS)
- G: builds a versioned bundle: `dist/code-red/` = player JS/CSS + core + copy patch + symbols.json + manifest
- S: Astro page = thin shell that loads the bundle
  - consume via: GitHub Release asset fetched at site build, or git submodule, or npm package from git tag
  - pick: **release asset** (no binaries in site git history)
- delete `web/index.html`, `bridge/browser-test.html` → one player everywhere

## 4. One dev command
- `make dev`:
  1. incremental ROM build (existing `dev.py build`)
  2. regenerate copy patch from `local/baserom.gba` (`make-copy-patch.py`) + `symbols.json`
  3. serve player with live reload; ROM rebuild → auto reload page
- `make check`: all tests that need the ROM (headless mGBA + Playwright)
- macOS path: Homebrew `arm-none-eabi-binutils` + agbcc build, or Docker image for build only
  - drop `x86_64-linux-gnu` sysroot hardcoding in `dev.py`

## 5. CI (ROM-free)
- GitHub Actions on G:
  - runner tests (Playwright + QuickJS)
  - protocol tests (JS encode/decode vs C structs via native compile)
  - player tests with a fixture core / fixture EWRAM
  - patch hygiene: patches apply cleanly to pinned upstream; ROM builds (no base ROM needed to *build*, only to make the copy patch)
- ROM-dependent checks stay local (`make check`)

## 6. Generalize bridge (after 1)
- see bridge-v2.md
- migrate stats-sum + scratchpad + naming onto it, delete old mailboxes

## 7. Branch + doc cleanup
- squash-merge stack → `main` (needs your OK; AGENTS.md: "Keep main untouched")
- replace evidence logs with: README (how to dev), ARCHITECTURE.md (one diagram), notes/
- AGENTS.md: drop "Do not invent a whole-mod design" once design notes land

## Open questions
- site host? (`vercel.json` deleted in astro rebuild — check how S: deploys)
- keep EmulatorJS or go lower-level (raw mGBA WASM build, own UI)? EmulatorJS = free touch controls/menus, costs = RetroArch layer, version guards
- physical phone test devices available?
