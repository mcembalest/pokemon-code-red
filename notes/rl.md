# RL experiment — can a baby Pokémon level up at writing move code? (2026-10-06)

Owner direction: each Pokémon = its own initialized model; EXP = experience data; level-up = a training step; genuine RL (design.md). This experiment checks feasibility before building around it.

## Question
- does a tiny open model (0.5B–1.5B) **visibly** improve at the starter moves after a play-session's worth of practice?
- "visibly" = miss rate drops / crit rate rises on held-out battles (new foes), in the game's own sandbox

## Setup
- env: `rl/env/` — the four starter moves as **provisional** code contracts (`contracts.mjs`); scored in **pi-codemode** (same sandbox as the game) by `evaluate.mjs`
  - one fenced JS block, no prose (format is part of the reward)
  - tool traffic metered in bytes vs the move's offensive budget (`moveBudget(level) = 120 + 12·level`)
  - miss 0 (crash / timeout / prose / wrong job / over budget) · hit 1 · crit 1.3 (minimal calls + ≤220 chars)
  - foes randomized per seed; eval uses held-out seeds (100000+)
- training: `rl/train.py` on Modal (L4 GPU) — TRL GRPO + LoRA (r16), rewards from the env; learning curve evaluated every N steps
- config: `rl/run.json` (edit + push → `.github/workflows/rl.yml` runs it; results → release `rl-results`)
- secrets: `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET` (repo Actions secrets)

## Models
- Qwen2.5-0.5B / 1.5B Instruct (Apache-2.0, ungated). Llama 3.2 1B/3B (Workers AI ladder) need a Hugging Face token (gated)
- per-Pokémon serving later: Workers AI LoRA (≤100 adapters/account, rank ≤32, <300 MB, some unquantized bases only) vs own multi-LoRA server vs in-browser

## Status
- [x] env + tests (`cd rl/env && npm test`): judge, budget, timeout, format
- [ ] smoke run on Modal (needs secrets)
- [ ] full run: baseline 0.5B vs 1.5B; train 0.5B ~200 steps; curve
