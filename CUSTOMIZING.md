# Customizing Code Red

Everything that makes Code Red Code Red is in a handful of files. This page says where each thing lives, what to run
after changing it, and how a change gets to players. Design notes with the why are in `notes/design.md`.

## The loop

```
git checkout -b my-change          # work on a branch
<edit>                             # see the table
make test                          # rules, player, kernel (no ROM needed)
make patches build                 # only for game-side (ROM) edits: write the patches, rebuild build/code-red.gba
git push                           # CI runs the tests, the sim and the model probes
```
Merging to `main` publishes a player bundle (release `player-<rom>-<sha7>`). The site picks it up on the next auto-pin,
or at once by editing `src/things/pokemon-code-red/bundle.lock.json` in `maxcembalest.com` (tag + sha256 from the
release's `code-red-player.tar.gz.sha256`). The backend deploys from `worker/` on every push to `main`.

To measure a change before shipping it: edit `rehearsal.json` on the branch (`"seeds": [0, 1]`) and push with
`[sim only]` in the commit message. The real models then play power-on → Lt. Surge, and results land on the
`rehearsal` release (`<sha7>-seed0-summary.json`, `turns.jsonl`). ~35 min, ~650k tokens a seed.

## What to change, and where

| You want to change | File | Then |
|---|---|---|
| **A number** — byte budgets, focus/temperature, notches, doubt cap, memory caps, badge bonuses, target byte counts, example numbers | `rules/knobs.mjs` (one file, every knob commented) | `make test`. Knobs marked `rom` are mirrored in the ROM: change the C too (below) |
| **A move**: its Code Red name, what the code must compute, the right answer | `rules/moves.mjs` → `TABLE` (`[FireRed name, CODE RED NAME, spec, answer]`). Names ≤ 12 characters; a function name that is a JS keyword is refused (`fnName`) | `make names` (writes the ROM's name table, patch 007, and the readable list `notes/moves.md`), `make build`, `make test` |
| **A new move** (one FireRed has that has no code yet) | add a `TABLE` row in its type's family, plus its FireRed stats in `rules/firered.mjs` (type, power, accuracy, effect from `src/data/battle_moves.h`) | same as above; `node --test rules/test` checks every answer |
| **A type's data format** (how a foe's numbers arrive) | `rules/formats.mjs` → `FORMATS[TYPE]` (`short`, `note` = the words the Pokémon reads, `encode`, `decode`); `HINTS` = the canonical reading line (labs only) | `make test` |
| **A type's move family** (the one-line description of what its programs do) | `rules/moves.mjs` → `FAMILIES` | `make test` |
| **The prompt a Pokémon writes from** | `rules/turn.mjs` → `turnPrompt` (system + user lines); memory lines in `rules/memory.mjs` → `memoryLines`, `lastTurnLine`; the end-of-battle prompt → `consolidatePrompt` | `make test`; measure with a rehearsal (prompt wording moves hit rates a lot: `notes/design.md` has eight measured versions of the memory prompt) |
| **How memory works** — what counts as a helper, when it is kept, the checks | `rules/memory.mjs` (`extractHelpers`, `checkSource`, `recall`), `player/src/agents/code-battle.ts` (`turn`, `consolidate`) | `make test`, then a rehearsal |
| **Doubt** (when it overrules your call) | the ROM rolls it: `src/code_red_battle.c` → `CodeRedDoubts` (patch 006); `rules/doubt.mjs` mirrors it for the page | `make patches build`; `sim/experiments/doubt.py` measures it in the ROM |
| **Payload moves** — sounds and pictures | `rules/payload.mjs`: `PALETTES` (per move), `SOURCES` (the worked example per sound/picture), `voiceOf` (species voices), the checkers that judge character | `make test`; the gallery artifact shows every move's reference and model outputs |
| **Which models write the code** | `kernel/write.mjs` → `BATTLE_MODEL`, `PAYLOAD_MODEL` (Workers AI ids). Per-player daily token cap and the unstreamed list: Worker vars `AI_DAILY_TOKENS`, `AI_NO_STREAM` (`worker/wrangler.toml` / the dashboard) | `make test`; `models/` has the probes and labs |
| **In-game text** — battle lines ("doubted your call!"), PokÉEG tabs and sentences, the intro, menu entries | the C/.inc sources in `.cache/pokefirered` after `make build`: `src/code_red_battle.c` (006), `src/code_red_eeg.c` (008: tab names `sText_Tab…`, every sentence `sText_…`), `src/code_red.c` (002), `data/text/new_game_intro.inc` (001), the PC menus (003/004) | `make patches build` → `sim/experiments/pokeeg.py` screenshots the PokÉEG → commit the patches |
| **The PokÉEG scan's look** (lobes, electrodes, channels) | in game: `src/code_red_eeg.c` (`sLobes`, `sElectrodes`, `Eeg_Waves`, the two palettes); on the page: `player/src/agents/scan.ts` (same numbers, keep them in step) | `make patches build`; `player/tests/pokeeg.py` |
| **Page text** — the code panel's lines, the PokÉEG panel's tabs, the hot-memory editor | `player/src/agents/code-panel.ts` (`describe`), `pokeeg.ts` (the `body` per tab), `player.ts` (ROM chooser, starter card) | `make player`; `player/tests/pokeeg.py` |
| **Badges** | `rules/knobs.mjs` → `BADGES` (`budget` bytes; add a key per badge) | `make test` |
| **Starter moves** (which moves are in the tutorial battle) | `rules/moves.mjs` → `STARTER_MOVES` | `make test` |
| **Where the sim plays to** | `sim/codered/routes.py` (`to_misty`, `to_surge`: one function per leg); `sim/rehearse.py --to` | `python3 sim/rehearse.py --mock` plays it with the stand-in model (no tokens) |
| **The stand-in model** (tests and `?agents=mock`) | `player/src/agents/code-battle.ts` → `mockWriter` | `make test` |

## Game-side edits in detail

The ROM is FireRed (pokefirered) plus `patches/NNN-*.patch`. `make build` applies them into `.cache/pokefirered`
(not in git) and builds `build/code-red.gba`. To change the game:

1. `make build` once, so the sources are there.
2. Edit the file under `.cache/pokefirered` (the table above says which).
3. `make patches` rewrites every patch from the edited sources (`scripts/regen_patches.py`; each patch keeps its
   header and owns a fixed set of files — a file no patch owns is reported). `make build` applies them again.
4. Commit the patches. CI fails if they are out of date (`scripts/regen_patches.py --check`).

Save structs: no layout changes without a migration (`scripts/save_guard.py`, see `AGENTS.md`). Never commit
`.gba`, saves, `local/`, `.cache/`, `build/`.

Move names are the exception: never edit `move_names.h` by hand — `make names` generates patch 007 from
`rules/moves.mjs`, so the page, the tests and the ROM always agree.

## Checking a change did what you meant

- `make test`: every move's answer, every format's round trip, the prompt, memory, doubt maths, the page's battle brain
  against the stand-in model.
- `sim/experiments/*.py`: things measured in the real ROM (`doubt.py`, `payload.py`, `pokeeg.py` with screenshots).
- `python3 sim/rehearse.py --mock --seed 0`: the stand-in model plays power-on → Lt. Surge in ~40 min, no tokens.
- A rehearsal on CI (above): the real models.
- `player/tests/*.py`: the real page in a headless browser (needs `make player` and `scripts/serve_player.py`).
