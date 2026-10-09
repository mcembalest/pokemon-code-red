# Battle lab, 2026-10-07 (2 h, iterative) — draft 5 of the battle rules

Rules: `rules/` (2026-10-08) = the one browser-safe module the game and the lab share: moves, type formats + Pokédex readers, growth + badges, turn prompt, judging, learning; tests `rules/test/`
Code: `models/lab/` (run.mjs = designs side by side; variants.mjs; lint.mjs; journey.mjs = Pallet → Misty sim) · workflow `lab.yml` (runs when `models/lab/run.json` or `journey.json` changes; results → release `lab`) · model: Llama 3.2 3B on Workers AI via pi-ai

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
- JS keywords can't be move functions (DEBUGGER → BREAKPOINT, THROW → CALL)
- focus: temperature .2 → .81, .7 → .75, 1.0 → .63–.74, 1.3 → .34–.40 · budget: 200 → .69, 300 → .92, 450 → .92
- journey (8 runs, ~110 turns each): learning + Pokédex .92 (L5 .77 → L17+ 1.0); tighter early .89 (L5 .69); learning only .77; fewer slots .76; nothing .66
- hard moves (3B, plain data): SPINUP, FAILOVER, JAMMER, SHARDS, TROJAN, WIPE, BREAKPOINT ≤ .5

## Later runs (same session)
- dual types, one function must read both formats: .45 (BUG/POISON .04–.13, ROCK/GROUND .63–.80, WATER/PSYCHIC .53–.82) → a wall, for gym leaders only
- journeys with gym walls: every leader Pokémon → Brock .25, Misty .45 · only the ace (ONIX, STARMIE) +150 bytes → Brock .72, Misty .46 · + a one-line tip on telling the formats apart → **Brock .70, Misty .64**, rest ~.93 (journey 9, 12 runs)
- without the tip, STARMIE ~0%: the 3B calls `.split` on the PSYCHIC object
- paralysis as half budget (150 vs 300): .20 vs .95 → too harsh; ¾ budget ≈ .75–.80
- foes (young, first time) attacking starters' formats: FIRE 1.00 · WATER .98 · GRASS .67 · POISON .54 → a format's difficulty acts as defense; FIRE may be too easy to read
- Pokédex on "seen" ≈ on "caught" (seen slightly smoother)
- cost: 4,032 moves ≈ 1.0M input + 0.24M output tokens → ~250 in / 60 out per move ≈ $0.004 per Pallet→Misty playthrough (Llama 3B list prices; foes would double it)
- lab 15: FIRE → out-of-order write log `{at, value}`, PSYCHIC → jumbled `b0…` keys (integer keys can't be out of order in JS). Per type, 40 tries each, first time / known: NORMAL .63/.95 · FLYING .55/.93 · WATER 1/1 · GRASS .55/1 · ROCK .98/.93 · ELECTRIC .88/.95 · GROUND 1/1 · FIRE .50/.93 · POISON .13/.95 · BUG .58/.95 · PSYCHIC .50/.78 · FIGHTING .80/.82 · STEEL 1/.97 (overall .70/.94)
- foes vs starters after the change: FIRE .56 · WATER 1.0 · GRASS .69 · POISON .40
- GitHub pushes failed with 500s for ~10 min mid-session; the REST git-data API is blocked by the proxy → just retry

- journey 10 (final, current formats, 12 runs): recommended (ace walls + tip) .84 — Brock .63, Misty .65, Cerulean rival .65 (new PSYCHIC format), L5 ~.85 → late ~.97 · no walls .90 · aces without tip .82 (Misty .45)

## Open (owner)
core rule · type formats (FIRE too easy? POISON too hard at first?) · gym walls (aces only, with a tip: Brock .70, Misty .64) · difficulty curve (~.80 at L5 → ~.97 late) · statuses (FireRed's; optional paralysis = ¾ budget) · foes writing code (defense = your own type's format) · hard moves
