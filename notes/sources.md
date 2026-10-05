# Sources

## Upstreams (pinned)
- pret/pokefirered @ 037335f — https://github.com/pret/pokefirered/tree/037335f4c725d7c9aecdac87066f2002b4bd7e14
  - `ld_script.ld`, `include/malloc.h`, `include/save.h`
- pret/agbcc @ da598c1 — https://github.com/pret/agbcc/tree/da598c1d918402c42c0c0d7128ba14567f3175e9
- EmulatorJS 4.2.3 — https://github.com/EmulatorJS/EmulatorJS/tree/v4.2.3
  - `data/src/GameManager.js` (cwrap list: no memory read; `getSaveFile`, `loadSaveFiles`)
- EmulatorJS/mgba @ db6592a — https://github.com/EmulatorJS/mgba/blob/db6592a591523ef9c45d129ed1ec792c71566d18/src/platform/libretro/libretro.c
  - `retro_get_memory_data` → `RETRO_MEMORY_SYSTEM_RAM` → GBA `memory.wram`
- quickjs-emscripten — https://github.com/justjake/quickjs-emscripten

## This project
- G: game @ 1189974 — https://github.com/mcembalest/pokemon-code-red/tree/1189974091a31acd05fde74a4dd0bb6e76e1287a
- G: dev/rom-runner-mailbox @ 1f1346d — https://github.com/mcembalest/pokemon-code-red/tree/1f1346d05f5441a1b69f8b36d772b55893aa5122
- S: PR 6 head @ 408c921 — https://github.com/mcembalest/maxcembalest.com/tree/408c921e9519181941fe14cd20841e1dd2fd5daf

## Decomp hacking refs
- save footer reclaim (Emerald; FireRed unverified) — https://code.heni.lol/decomp/emerald/wiki/Extra-save-space-with-three-lines-of-code
- libretro memory API discussion — https://forums.libretro.com/t/read-console-memory/45275

## TODO find
- FireRed-specific RAM-freeing guides (pokefirered wiki)
- EmulatorJS 4.3 changelog: any memory read API?
