# Battle lab, 2026-10-07 (2 h, iterative) — draft 5 of the battle rules

Code: `models/lab/` (run.mjs = designs side by side; variants.mjs; formats.mjs = type formats + Pokédex readers; lint.mjs; journey.mjs = Pallet → Misty sim) · workflow `lab.yml` (runs when `models/lab/run.json` or `journey.json` changes; results → release `lab`) · model: Llama 3.2 3B on Workers AI via pi-ai

## Draft 5 rule (proposed)
- a move = a function the Pokémon writes (`function slice(data)`); the game calls it on the foe's real data (never shown); right answer = hit, then FireRed as usual
- each foe type writes its data in its own format (from `notes/types.md`): NORMAL list · FLYING JSON text · WATER lines · GRASS `byte=` log · ROCK hex dump · ELECTRIC binary · GROUND CSV · FIRE records · POISON x-separated text · BUG nested lists · PSYCHIC out-of-order object · FIGHTING pairs to add · STEEL XOR 255
- dual types: either format per turn, the turn says which
- readers: one line that reads a type (`const bytes = data.split(' ').map(h => parseInt(h, 16))`)
  - learned: after a hit, kept only if it truly reads the data (checked by the game) — else lucky hits teach wrong habits
  - Pokédex: catching a species gives its type's reader to the whole party
  - memory slots cap how many readers a Pokémon keeps (2 at L5, grows; big jump at evolution)
- byte budget = max code size (200 + 10/level, +100 at evolution); focus = temperature (0.8 → 0.3 with level)
- statuses: keep FireRed's (code rules for statuses were too harsh)

## Results (3B, starter moves × 13 types unless noted)
| design | hit |
|---|---|
| draft 4: junk + cleanup rule, as steps | .50 |
| type format, as scan/read/key/strike steps | .46 |
| move = function, plain data | .98 |
| function + type format (first encounter) | .73–.80 |
| function + example only | .45 |
| function + format + reader (Pokédex/learned) | .94 |
| type = linter rule | .75 (FIRE "no comments" .07) |
| gym rules (Brock no loops, Misty const only) | .92 |
| status as code rule: poisoned no Math / paralyzed single return / burned ≤3 lines | .85 / .21 / 0 |
| own past functions in memory | .76–.86 (no help) |
| Qwen 32B, all 103 moves with readers | 1.00 |
- worked example in each move's text (input → output) fixed most wording misses; names must fit the operation (FLUSH/WIPEDISC swapped)
- JS keywords can't be move functions (DEBUGGER → BREAKPOINT, THROW → SYSCALL)
- focus: temperature .2 → .81, .7 → .75, 1.0 → .63–.74, 1.3 → .34–.40 · budget: 200 → .69, 300 → .92, 450 → .92
- journey (8 runs, ~110 turns each): learning + Pokédex .92 (L5 .77 → L17+ 1.0); tighter early .89 (L5 .69); learning only .77; fewer slots .76; nothing .66
- hard moves (3B, plain data): SPINUP, FAILOVER, JAMMER, SHARDS, TROJAN, RM -RF, BREAKPOINT ≤ .5

## Open (owner)
core rule · type formats · difficulty curve (late game ~100%) · statuses · foes writing code (defense = your own type's format) · hard moves
