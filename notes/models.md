# Workers AI model probe — starter moves (2026-10-06)

`models/` (probe.mjs, probe.json) · workflow `.github/workflows/models.yml` · raw results: release `model-probe`
- each model writes one JS block per move; scored in pi-codemode (game sandbox) on held-out random foes; 16 samples × 4 moves; level 5 prompt; temp 0.8
- contracts are provisional (rl/notes); SCRATCH = sort indices (hardest), TACKLE = sum, GROWL/TAIL WHIP = arithmetic on one stat
- harness is lenient: unfenced code accepted; a single uncalled `function x(){}` gets called (run 1 without this: 3B/8B ~95–100% miss)

## Run 2 (lenient)
| model | miss | hit | crit | p50 latency | notes |
|---|---|---|---|---|---|
| llama-3.2-1b | 0.88 | 0.02 | 0.11 | 0.6 s | mostly syntax/runtime errors; only status moves land |
| granite-4.0-h-micro | 0.33 | 0.42 | 0.25 | 2.1 s | |
| llama-3.2-3b | 0.34 | 0.12 | 0.53 | 0.4 s | fast; SCRATCH 81% miss |
| llama-3.1-8b-fp8 | 0.36 | 0.16 | 0.48 | 3.6 s | not better than 3B, 8× slower |
| mistral-small-3.1-24b | 0.30 | 0.09 | 0.61 | 1.9 s | misses mostly prose around code |
| qwen2.5-coder-32b | 0.00 | 0.25 | 0.75 | 1.6 s | never misses |
| gpt-oss-20b, qwen3-30b-a3b, gemma-4-26b | ~1.0 | — | — | 2–6 s | harness issue (reasoning output / empty replies), not skill — unverified |

## Read
- natural ladder exists: 1B (fumbles) → 3B / Granite / 8B (~⅓ miss) → Mistral 24B → Qwen coder 32B (0 miss)
- move difficulty differs by model size (SCRATCH separates small from big) → moves can feel harder for young Pokémon
- latency fine for turns except 8B (3.6 s)
- 16 samples/move: rough (±~12 pts)

## Scaffolding run (2026-10-06 night) — can a small model play a high-level Pokémon?
`models/scaffold.mjs` · memory = notes from 12 warm-up tries per move (its own shortest working code per move, or "missed every time") · retry = on crash, sees the error and rewrites (≤2)

| model | plain | + memory | + retry2 | + memory + retry2 |
|---|---|---|---|---|
| llama-3.2-3b | miss .38 / crit .59 | **miss 0 / crit .75** | miss .36 | miss 0 / crit .75 |
| llama-3.2-1b | miss .91 | miss .72 | miss .89 | miss .73 |
| gemma-2b-it-lora | miss 1.0 | 1.0 | 1.0 | .98 |
| (ref) qwen2.5-coder-32b plain | miss 0 / crit .75 | | | |

- **3B + its own memory = Qwen Coder 32B** on these moves (SCRATCH 94% → 0% miss; one lucky win in warm-up was enough)
- crash-retries barely help (most misses are wrong logic, not crashes)
- 1B: memory helps a little; gemma-2b (LoRA-capable base on Workers AI) unusable as-is
- caveat: here a move's task is identical every battle → memory = cached solution → never misses again. For the game: memory must help without trivializing (capacity limits, newly learned moves start blank, tasks that vary with the situation)

## Scaffold run 2 (2026-10-07) — situational tasks + memory size limits
tasks now vary with foe type/status/guarded slots (`SITUATIONAL` in contracts.mjs) · memory = same warm-up notes, cut to whole entries under the limit

| model | plain | mem 400 | mem 1000 | mem 2500 |
|---|---|---|---|---|
| llama-3.2-3b | miss .63 | .72 | .59 | **.42** |
| llama-3.2-1b | .98 | 1.0 | .98 | 1.0 |
| qwen2.5-coder-32b | .13 | **0** | 0 | 0 |

3B per move, miss at mem 2500: SCRATCH 1.0 · TACKLE .44 · GROWL .19 · TAIL WHIP .06

- situational rules hurt the 3B a lot (plain .38 → .63); the 32B barely notices
- memory still helps the 3B, and more memory helps more → memory limit is a real growth knob
- memory no longer trivializes moves: a remembered solution must be adapted to this foe
- SCRATCH (filter guarded, sort, take 2–3) is out of reach for the 3B at L5 even with memory → fine for a starter's *first* move? or simplify; a design call (D1)
- 1B is out

## Run 3 (2026-10-07) — on the pi kernel
`models/kernel-exp.mjs` on `kernel/` · Pokémon = pi-durable conversation · model via pi-ai Workers AI provider · move = pi-codemode block · situational rules · 16 samples × 4 moves · provider-default temperature

miss rate (lower is better):

| model | block | block + mem 2500 | pi code tool | tool + mem 2500 | p50 (block) |
|---|---|---|---|---|---|
| llama-3.2-3b | .64 | **.44** | .94 | .86 | 0.6 s |
| granite-4.0-h-micro (~3B) | .61 | **.34** | .81 | .63 | 3.3 s |
| qwen2.5-coder-32b (ref) | .06 | .06 | 1.0 | 1.0 | 3.9 s |

- **the kernel reproduces scaffold run 2** (3B .63 → .42 there) → the pi port is faithful
- **code block beats pi's code tool** for every model on Workers AI: Qwen writes its tool call as text (Workers AI doesn't parse it); Llama's code inside tool-call JSON breaks more often; Granite tool calls are 2–3× slower → **moves = code block replies** (kernel default `mode: 'block'`)
- Granite ≈ Llama 3B on quality, 5× slower → **Llama 3.2 3B stays the one model**
- SCRATCH (situational) still ~100% miss for both 3Bs → D1 decision
- first attempt (run 3a) was void: Workers AI streams numeric tokens as JSON numbers and pi-ai drops them → every block lost its digits. Fixed in `kernel/cf-fetch.mjs` (also flattens array message content, which Granite rejected)

## Battle rule runs (2026-10-07) — clean by foe type → compute the move → strike once
`models/battle/` (moves.mjs = 103 renamed moves with reference answers; types.mjs = 13 foe-type cleanups; exp.mjs) · no memory unless noted · hit rate (higher is better)

| run | 3B: moves vs NORMAL | 3B: starter moves × all types | 32B: moves vs NORMAL | 32B: starter × types |
|---|---|---|---|---|
| 1 (stream bug: `[] {} null true` tokens dropped) | .21 | .10 | .72 | .68 |
| 2 (fixed; answer shape shown) | .41 | .23 | .93 | .66 |

- run 2: the 32B hits 93% of moves → specs are mostly clear; the misses pointed at wording (POKE "position 1", FORKBOMB "doubled", LOOP, BRUTEFORCE) → reworded
- both models mostly **ignored the type cleanup** when it sat in the foe line → run 3 gives the turn as steps: scan / clean / key / strike
- Workers AI streams: Llama sends the token `null` as `"content": null` (recoverable); Qwen's `null` never arrives → no move's answer is null
