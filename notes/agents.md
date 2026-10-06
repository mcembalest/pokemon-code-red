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

## Byte battles v1 (2026-10-06, owner decisions → notes/design.md)
- HP = byte budget. A damaging move is a fixed script (`player/src/agents/moves.ts`); its output lands in the foe's context; output bytes replace the base damage
  - then the engine applies crit, type match-up, STAB, random roll → **absorbed** bytes = HP lost (box: "5 sent · 4 absorbed by SQUIRTLE")
  - scripts write out the Gen 3 base formula (`force`) → balance ≈ vanilla; GROWL/TAIL WHIP = status scripts (no bytes; engine stat effect)
  - language-neutral (owner: not starter = language for now); run in the QuickJS sandbox
- ROM: `patches/006-byte-battles.patch` — `Cmd_damagecalc` asks the host via `gCodeRedBattleBytes` ('CRB1', 48 B; `player/src/bridge/battle-bytes.ts`), waits ≤1800 frames, else vanilla. Host enables it; no host (sim, plain player) → vanilla
- agent sees bytes: persona explains the rules; each action's description includes its script source; observation has "bytes left" + the last output that landed in its context (seed for adversarial tool calling)
- first agent moment (Pallet): starter card in Oak's lab while "So! You want ___?" — `agents/starter-card.ts` (monpic task in `gTasks` + VAR_TEMP_2); then the rival battle with the starter in control (Agent button pressed by default; tap to take over)
- on by default for every invited player (owner, 2026-10-06); kill switch: worker var `AGENTS = "off"` (wrangler.toml) → `features.agents=false` on join/me + `/v1/llm` 403; `?agents=off|mock|replay|on` overrides for testing
- test: `player/tests/agent_battle.py` — starter card (lab fixture) → rival battle: byte hits both ways (scratch.js, tackle.js), win, replay
