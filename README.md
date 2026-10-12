# Pokémon Code Red

FireRed mod where Pokémon are coding agents. Players bring their own FireRed (USA, v1.0) file; the browser patches it locally and runs it with a small code bridge.

To change a move, a format, a number, the prompt or in-game text: **`CUSTOMIZING.md`**.

## Layout

```
patches/    source patches on pinned pret/pokefirered (upstream.lock.json); 006–009 are the code moves, PokÉEG, payloads
rules/      the battle rules both the page and the sim play by: moves, data formats, growth, memory, doubt (knobs.mjs = every number)
player/     browser player (TypeScript) -> player/dist, embedded by the website
  src/bridge/   GBA RAM access + mailbox protocols (code moves, PokÉEG, naming)
  src/agents/   the battle brain: prompts the model, judges the code, keeps each Pokémon's memory
kernel/     the model client (Workers AI) shared by the page's backend and the labs
worker/     the backend (Cloudflare Worker): invites, accounts, cloud saves, the model proxy with a daily token cap
runner/     QuickJS/WASM sandbox for player code (fresh VM per run)
sim/        headless playthroughs (power-on → Erika) for CI and the rehearsals that measure a change with the real models
models/     model probes and labs (which model, which prompt)
core/       emulator core adapter + patches; built by CI, pinned in core/release.json
scripts/    dev.py (setup/build), regen_patches.py, move_names.py, rom_bundle.py, symbols.py, serve_player.py, ...
tests/      unit + native (headless mGBA) tests; player/tests/e2e.py (Chromium)
notes/      working notes (design.md: every decision and what was measured)
```

## Dev loop

Prereqs: `git python3 make gcc g++ binutils-arm-none-eabi libpng-dev node>=22`; `libmgba-dev` for native tests.
macOS: `brew install arm-none-eabi-binutils libpng node` (plus `mgba` for native tests).

```sh
make setup                      # pinned decomp + compiler, emulator packages, npm deps
cp /path/to/firered.gba local/baserom.gba   # or: python3 scripts/dev.py baseline && cp build/baseline.gba local/baserom.gba
make dev                        # build ROM -> rom bundle -> player -> http://127.0.0.1:8000/
```

Edit → `make dev` → reload. Game source lives in `.cache/pokefirered` (ignored); `make patches` writes edits back as `patches/NNN-*.patch` (`make names` for the move-name patch).

`make test` (no ROM needed) · `make check` (plus headless ROM tests) · `python3 player/tests/e2e.py` (browser, needs `make serve`).

## How the pieces fit

- **ROM** stays thin: game logic + small fixed RAM mailboxes. Addresses come from the link map → `build/rom/rom.json`; nothing is hardcoded elsewhere.
- **Core** (`core/adapter.inc`) is ROM-agnostic: exports EWRAM/IWRAM pointers and a reset/load epoch. Game changes never require rebuilding it. CI (`core.yml`) builds it from pinned sources and publishes `core-<content hash>` releases.
- **Player** reads/writes mailboxes from JS (`player/src/bridge/`), runs code in `runner/`, and keeps the in-game battery save (not emulator states), so saves survive updates as long as save structs don't change.
- **No ROM bytes are distributed**: the copy patch (`CRCP1`) only lists offsets into the player's own file.
- **CI** (`ci.yml`) builds everything from source (the decomp reproduces the base ROM exactly), runs all tests incl. a Chromium playthrough, and on `main` publishes `player-<rom>-<commit>` bundles for the website.

## Rules

- Never commit `.gba`, saves, `.cache/`, `build/`, `local/`.
- Don't change save struct layouts without a migration (breaks every player's save).
- New game↔browser features: add a mailbox struct in a patch, its symbol to `scripts/symbols.py`, and a protocol in `player/src/bridge/` with tests. No core change needed.
