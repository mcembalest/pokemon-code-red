# Agents — framework v0 + battle prototype (2026-10-06)

Code: `player/src/agents/` · tests: `player/src/agents/*.test.ts`, `player/tests/agent_battle.py`

## Framework (`agent.ts`, `brains.ts`)
- `AgentSpec { id, name, persona, actions[1..4] }` — 4 moves = 4 actions; enforced by `checkSpec`
- `Action { id, description, params? }` — params: string/integer/boolean, optional enum, all required; `thought` reserved
- `Brain.decide({spec, observation, history}) → Decision { action, args, thought }`
- `Agent.turn(obs)` → validate → fallback on invalid/error (never throws); keeps `history` (last 6 sent to the brain) + `records`
- `Agent.setSpec` — action set may change between turns (moves learned, PP out)
- brains:
  - `CloudBrain` — Claude Sonnet 5.5 via worker `/v1/llm`; actions → tools; `tool_choice: any` (always exactly one action); `thought` = required first tool field (≤12 words, shown to player)
  - `MockBrain(policy)` — CI/offline
  - `ReplayBrain(records)` — by observation key (FNV-1a of agent id + text), else in order; optional `miss` brain
  - local (wasm/WebGPU) — not built; same interface (design.md → Local models)
- records: `DecisionRecord { agent, key, observation, decision, brain, ms, fallback? }`; player sends `agent_decision` events (brain, action, thought, ms); worker `llm_calls` keeps full requests/responses

## Battle prototype (throwaway; battle mechanics TBD)
- on with `?agents=on` (Sonnet; needs an invite session) or `?agents=mock` (greedy baseline); adds an **Agent** toggle next to 10×
- lead Pokémon = agent; its usable moves = its actions (`battleSpec`); observation = foe/you name, level, HP, types (`observe`)
- `BattleReader` — RAM: gMain.callback2, gBattlerControllerFuncs (static `HandleInputChoose*` via `symbols.py` WANTED_LOCAL), gBattleMons, cursors, gBattleOutcome; ROM: gMoveNames/gSpeciesNames/gTypeNames/gBattleMoves (from the patched ROM bytes already in the page)
- `BattleAutopilot` — FIGHT → pause game → agent turn → GBA-style box ("X is thinking…" → “thought” ▶ MOVE) → resume → cursor → A; between turns presses **B** to advance text (B = NO on "switch?" prompts)
- result of previous turn (HP deltas) fed back via `noteResult`
- screenshot: `build/agent/thinking.png` (local)

## Sim ↔ browser states
- sim core = browser core → sim save states load in the page: `EJS_emulator.gameManager.loadState(bytes)` (raw libretro state = `World.save_state()[:-8]`)
- fixtures: `python3 sim/make_states.py` → `build/sim/checkpoints/*.raw` (private; RAM only, never publish)
- CI: builds sim core (cached) → fixtures → `agent_battle.py` (rival battle won in 4 turns with mock brain locally)

## Not done / open
- Sonnet path untested end-to-end from here (sandbox can't reach workers.dev) → owner check: `maxcembalest.com/pokemon-code-red?agents=on`, start a battle, tap Agent
- no replay UI; no recorded runs fed back to the sim yet
- agents in the sim (Python) would need a port or a JS runner; today the sim's battle policy is separate (`sim/codered/battle.py`)
- latency: Sonnet ~1–3 s per turn while the game is paused
