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
