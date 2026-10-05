# Memory budget — measured

Source: vanilla build of pret/pokefirered `037335f` with agbcc `da598c1`, 2026-10-04.
Output SHA1 `41cb23d8dccc8ebd7c649cd8fbb58eeace6e2fdc` = FireRed USA v1.0 (matches `firered.sha1`).
Numbers from `arm-none-eabi-readelf -S pokefirered.elf`.

## EWRAM (256 KiB = 262,144 B)
- `ewram` section size `0x3fbb0` = 261,040 B → **1,104 B free (vanilla)**
  - Code Red mod per bridge/README: "Remaining EWRAM budget is 1000 bytes" → mod used ~100 B
- but: first **0x1C000 = 114,688 B is the dynamic heap**
  - `ld_script.ld`: `gHeap = .;` `. = 0x1C000;`
  - `include/malloc.h`: `#define HEAP_SIZE 0x1C000`
  - runtime features can `Alloc`/`AllocZeroed` from it while open, `Free` on close (how vanilla menus work)
- so: static globals tight; transient buffers fine

## IWRAM (32 KiB)
- `iwram` section `0x7480` = 29,824 B; rest is stack. Treat as full.

## ROM (cart max 32 MiB)
- ld_script: `ROM (rx) : ORIGIN = 0x8000000, LENGTH = 32M`
- sections end `0x0872B860` (multiboot_data), then `gfx_data` at `0x08D00000`
  - gap ≈ 0x5D47A0 = **~6.1 MB free mid-ROM**
- last non-0xFF byte at 0xEB0B20 → ~1.37 MB free to 16 MiB; ~18 MB to 32 MiB
- ROM space is not a constraint

## Save (flash)
- `include/save.h`: `SECTOR_DATA_SIZE 3968`; SB2 = sector 0, SB1 = 1–4, storage = 5–13
- sizeof (compiled with agbcc):
  | block | size | capacity | free |
  |---|---|---|---|
  | SaveBlock2 | 3,876 | 3,968 | **92** |
  | SaveBlock1 | 15,720 | 15,872 | **152** |
  | PokemonStorage | 33,744 | 35,712 | **1,968** |
- Emerald decomp trick reclaims sector footers (not verified for FireRed):
  > "This gives you an extra 116 bytes in SaveBlock2, an extra 464 bytes in SaveBlock1, and an extra 1044 bytes in PokemonStorage." — [pokeemerald wiki mirror](https://code.heni.lol/decomp/emerald/wiki/Extra-save-space-with-three-lines-of-code)

## Implication
- ROM = game shell. Browser = everything about code.
- ROM holds IDs/flags only; agent code, prompts, tests, progress → IndexedDB
- link the two with a **save ID**: 16 B random UUID in SaveBlock2 slack (92 B free)
  - browser data keyed by save ID → survives ROM rebuilds; export = .sav + JSON bundle
- transient UI buffers in ROM → heap Alloc/Free, not new statics
