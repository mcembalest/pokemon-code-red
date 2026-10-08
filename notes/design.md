# Design — Pokémon Code Red

Living doc. Decisions = settled (owner). Open = not yet. Seeds = ideas to react to, not decisions.

## Goals
- friends play it and finish a meaningful chunk because it's fun
- they get better at C, Go, Python (experienced players, not beginners)
- "Pokémon are AI coding agents" is the core, not decoration
- on maxcembalest.com, no installs, ROM stays user-supplied
- track every player's progress; expose to players later

## Decisions (2026-10-05)
- **Pokémon = AI agents that code.** Player can also write code at the PC.
- **4 moves = 4 actions.** Each agent is scoped to ≤ 4 actions (tools), like ≤ 4 moves. Actions have powers/effects (details TBD).
- **Not freeform** code-writing as the core loop.
- **Languages: C, Go, Python.** Challenges are *sometimes* language-neutral, sometimes language-specific.
- **Endgame:** modify the game's own C (players + their agents, via C/Go/Python). Not the starting point.
- **Mobile-friendly**, not laptop-first.
- **Audience:** owner's friends (adults). Not kids.
- **Backend: Cloudflare** — AI API calls + storage. Owner pays for a handful of users.
- **Access: invite codes.**
- **Progress tracking:** internal first, player-facing later.
- **Model: Claude Sonnet 5.5** for all agent calls while cloud-backed (owner, 2026-10-06: Opus overkill; pre-5.5 models too weak). Worker allowlist = `claude-sonnet-5-5` only.
- **PC = remote login (VDI) to the player's home desktop** — canonical, always-available place the player works from. Player-owned code: not a strong concept yet. (2026-10-06)
- **Agent action = a script that is also a battle move** — both battle move and coding move. (2026-10-06)
- **HP = byte budget ("byte stamina")** — winning = the opponent spends its finite bytes while working during the battle, not harm. Must still read as HP to Pokémon players. (2026-10-06, "could be")
- **First agent moment = Pallet Town**: choosing the starter + the first (rival) battle. (2026-10-06)
- **Agents → zero API calls (target).** Small agent harnesses + tiny open-source models running in the browser (wasm / WebGPU). Anthropic API = interim backend only, behind the same interface. (2026-10-05)

## Persistence + accounts (owner, 2026-10-06) — agreed direction, not built
- **The in-game save is the only commit point.** Game save + every party Pokémon's agent state → one bundle → Cloudflare
  - between saves: browser tab only (current battle, code just written, what Pokémon "experienced"); quit without saving = lost, for game and agents alike
  - load (any device) = that bundle exactly → Pokémon remember what they remembered at save time
  - → reverting is consistent: one save slot (FireRed), emulator save states hidden; no game-vs-agent-memory divergence
  - server keeps every save version (owner-only safety net / debugging, not a player feature)
- **Login: username + password**, chosen when redeeming an invite
  - password hashed server-side (PBKDF2 via WebCrypto in the Worker); login attempts rate-limited
  - no email → forgotten password = owner resets it from /admin
- **One active device**: a login elsewhere takes over (owner: "refuse and explain")
  - proposed: new login asks "playing on another device — continue here?"; old tab is told it was signed out, game pauses
  - the old tab can no longer save (server only accepts saves from the current session) → no overwrites
  - not "block the second login": a dead phone / forgotten laptop would lock the player out
- **Agents** (pi-durable): in-memory in the browser during a session; exported into the save bundle; imported on load. Its crash-recovery is not used (unsaved = forgotten by design) — keep it only if export/import is clean
- progress/telemetry events stay live + separate (analytics, not game state)

## Kernel (proposed, 2026-10-06)
- pi 1.0 (`@earendil-works/*`, pinned exact): `pi-codemode` (one move = one code block in QuickJS, tool calls metered in bytes), `pi-durable` (a Pokémon = a conversation: identity, history, docs, moves as tools), `pi-ai` (Sonnet via the worker now; local model later)
- browser spikes ok in Chromium: codemode via ~40-line `node:worker_threads` shim (~26 KB + 287 KB wasm gz); durable with MemoryStorage + faux model (~103 KB gz). iOS Safari untested
- open: language runtimes for C/Go/Python (codemode is JS/QuickJS only)
- built 2026-10-07 (`kernel/`, owner: "pi ecosystem by default for everything"):
  - Pokémon = pi-durable conversation; its self (species, level, language, memory, memory limit) = conversation doc `code-red.mon`, rendered into its system prompt
  - battle = `reset()` (fresh context, same self); move = one turn; judging stays in the game
  - model = pi-ai, Workers AI provider (pi's catalog + Llama 3.2 3B/1B, Qwen Coder 32B added)
  - move hand-off: code block reply, or pi's `code` tool call → A/B in run 3 (`notes/models.md`)
  - in-battle state (current move's battle functions) is not durable, by design
  - browser bundle (`kernel/build.mjs`): kernel.js ~200 KB gz + QuickJS wasm ~640 KB (lazy-load when agents are on); Chromium smoke test in CI
  - model route live: Worker `POST /v1/ai/chat/completions` (OpenAI-compatible; AI binding → AI Gateway; session token = API key) → browser pi-ai provider `gameApiProvider`
  - not yet: wired into the player; save-file storage (pi-durable SQLite/JSONL core → the cloud save); iOS Safari check

## Battle decisions (owner, 2026-10-06)
- **Player picks the move** (FIGHT → move, as in FireRed). **The Pokémon writes the code for it at inference time.** Bad code is one reason a move can miss
- **Moves are language-independent.** Some moves fit some languages better. Pokémon can write several languages; stronger Pokémon write more powerful code blocks
- **Level = how good a coding agent it is.** Level grows the HP byte budget and its programming ability

## Battle decisions, round 2 (owner, 2026-10-06)
- **Starter's first language: JavaScript** (fits codemode + browser)
- **"More powerful code block" = bigger per-move byte budget.** Two budgets: HP bytes = defensive work; per-move bytes = offensive work. Both grow with level
- **Real tiny models at the lowest levels** ("baby Pokémon don't have to be that good"); bigger models as they grow
- **Move autopilot off.** Player picks moves; agents are codemode (they write the move's code)
  - live 2026-10-06: autopilot only with an explicit `?agents=mock|replay|on` (test harness); fixed byte-battle scripts + starter card still on until codemode replaces them

## Round 3 decisions (owner, 2026-10-06 night)
- **Variety:** stock model + LoRA adapters + other swappable / composable / randomizable state for wild Pokémon
  - note: Workers AI LoRA bases are few (gemma-2b-it-lora, gemma-7b-it-lora, mistral-7b-v0.2-lora, llama-2-7b-lora) — none is Llama 3.2 3B
- **Stats:** FireRed's Attack / Sp. Atk / Defense / Sp. Def, with FireRed's physical/special split by type
- **Status:** sleep / paralysis / confusion ideas OK; **rethink poison** → now: Poison = Malware (types.md) → poisoned = **infected**: a background process (cryptominer) spends your bytes every turn; badly poisoned (Toxic) = a worm, worse each turn
  - consistent with types.md: paralysis (Electric = Power) = brownout, power-throttled · sleep = suspended · confusion = code aimed at the wrong target · (after Misty) burn = write wear · freeze = stuck at a snapshot
- **One small model for every Pokémon (3B-class), not a ladder.** The challenge: make the small model good enough with what the harness gives it. Find the smallest that works. Question: Qwen 32B could pretend to be Lv5 — can a 3B play Lv55?
- **Memory:** each Pokémon has always-in-context memory it accumulates bit by bit at every level-up; grows a TON at evolution
- **Byte budgets:** small jumps per level, massive jumps at evolution
- **Types:** keep all type match-ups (FireRed). Type ↔ storage & security concepts: `notes/types.md`
- **No LoRA adapters.** Variety = swappable/composable state on one shared small model (owner, 2026-10-06)
- **Keeping growth meaningful** (owner agreed, 2026-10-06), since memory lets a 3B match a 32B (`notes/models.md`):
  - memory has a size limit: grows a little per level, a lot at evolution
  - a newly learned move starts with no memory → fumbles at first, improves with use
  - move challenges vary with the situation (foe, type match-up, status) → remembered code helps but doesn't always fit

## Models + growth (owner, 2026-10-06 evening)
- **Models run on Cloudflare** (Workers AI). No GPUs of our own, no training for now
- **XP: nothing happens yet. Level-up: stats update.** Growth = state, not weights
  - stats that grow at level-up: HP byte budget (defense), per-move byte budget (offense); possibly model tier at set levels (e.g. 1B → 3B → 8B on Workers AI) — to confirm
  - later: noticeable state growth without training (ideas, not decided: per-Pokémon library of its own working code fed back into prompts; habits/quirks from its history)
- **Parked:** per-Pokémon weights + RL training. Experiment code kept on branch `rl-experiment` (move contracts scored in pi-codemode; GRPO+LoRA on Modal) — not merged, not run; Modal not needed

## Starter battle spec — DRAFT for review (2026-10-06)
Battle: rival's first battle in Oak's lab. Lv5 starter vs Lv5 rival starter. Moves: CHARMANDER SCRATCH/GROWL, SQUIRTLE TACKLE/TAIL WHIP, BULBASAUR TACKLE/GROWL
- turn
  1. player picks a move (vanilla menu)
  2. the Pokémon writes one code block for it (model call; shown typing over the battle; no prose, comments only)
  3. block runs in the sandbox; calls to the move's battle functions are metered in bytes
  4. outcome → vanilla battle text + HP bars
- HP = byte budget (proposal)
  - running a block costs the runner's own bytes (small: what its code spends) → concise code is literally HP-efficient
  - a hit forces bytes of work onto the target (main drain), capped by the move's power + stats
- skill replaces luck (proposal): the code decides what FireRed decides with RNG
  - accuracy check → did the block run and do the move's job (crash/timeout/wrong job = miss)
  - critical hit → exceptionally tight block
  - 85–100% damage roll → how efficiently the block did the job
  - type match-ups, STAB, stat stages stay as in FireRed
- rival's Pokémon writes code too (its own model call per turn); trainer AI still picks its move
- shown: code window over the top of the battle; foe's code too; Oak's tutorial lines explain what you're seeing
- open
  - ~~language~~ → JS · ~~power~~ → per-move byte budget · ~~model per level~~ → real tiny models at low levels
  - which tiny model + runtime (wllama / WebLLM / transformers.js); download size on phones; needs model hosting reachable (Hugging Face is blocked from the dev sandbox → allowlist or self-host on R2)
  - level → (HP bytes, per-move bytes, model) table
  - latency budget per turn (Sonnet ~2–5 s × 2 Pokémon)

## Local models (target) — notes
- why it fits: ≤4 actions → the model mostly *chooses* among ≤4 tools + fills small args → constrained decoding (grammar / JSON schema) makes tiny models reliable
- harness interface must be backend-agnostic: `decide(state, actions[≤4]) → {action, args}`; backends = `local` (wasm/WebGPU), `cloud` (Worker `/v1/llm`), `replay` (recorded), `mock` (sim/CI)
- candidate runtimes (check before choosing; not yet evaluated):
  - wllama — llama.cpp → wasm, GGUF, CPU (works without WebGPU, e.g. older iOS); GBNF grammars
  - WebLLM (MLC) — WebGPU, faster; needs WebGPU (iOS Safari 26+)
  - transformers.js (ONNX Runtime Web) — wasm + WebGPU
- mobile constraints: model download size (cache in Cache Storage/OPFS once), RAM (~0.5–1.5 B params at 4-bit ≈ 0.3–1 GB), first-token latency; WebGPU availability varies
- determinism: local inference w/ fixed seed + greedy still not bit-stable across GPUs → record decisions for replay, same as cloud
- open: which model(s); per-"species" models (different small models = different personalities/types?)

## Open
- battle mechanics — how much "adversarial tool calling" (agents' actions vs each other)
- what the 4 actions can do (powers, costs, effects); how they're learned/replaced (move tutor/TM analogues?)
- types ↔ ? (languages? domains? model families?)
- what levels/evolution mean for an agent (budget, context, tools, model tier?)
- how the player's skill matters when agents are capable (see Risks)
- store player code server-side? (enables "see others' solutions"; more data to hold)
- which model(s) / provider behind the agents

## Constraints from the foundation
- Go/Python run in browser sandboxes; only C can realistically run on the emulated GBA ("on the cartridge")
- presentation can hide that: GBA-styled windows (pixel font, frames, palette) over the canvas + results flowing into real in-game effects through the bridge (notes/bridge-v2.md)
- EWRAM static budget ~1 KB; heap for transient buffers; agent state lives server/browser-side keyed by a save ID (notes/memory-budget.md)
- save struct layouts frozen unless migrated
- simulator (sim/) must stay deterministic → agent calls recordable/replayable + mock agent for CI

## Risks / pushback
- **capable agents → player just presses A.** Agent weakness should come from constraints (≤4 actions, budget, context, tools), not weak models — models improve, difficulty would drift
- **latency:** LLM calls take seconds vs 60 fps → agent "thinking" must be part of the presentation (turns, animations)
- **3 languages ≈ 3× runtime/error-message/tuning work** → share content where neutral; per-language only where it pays
- **scope:** FireRed ≈ 25 h; friends give 1–3 h → dense slice first (e.g. Pallet → Misty)
- **endgame ROM mods:** applied as per-player runtime patches (we already patch each player's ROM in their browser); no in-browser decomp build needed

## Seeds (react, don't adopt)
- adversarial tool calling: an action's output enters the opponent agent's context (prompt-injection as an attack class?) — fun, but needs strict sandboxing of effects
- agent "thinking" shown as the battle animation; cheaper actions resolve faster
- PC = where the player writes/edits actions themselves (in C/Go/Python), then teaches them to an agent
- progress events: badges, flags, playtime, challenge results, action usage

## Architecture sketch (proposed)
```
browser (player + ROM + bridge + sandboxes: QuickJS / Python wasm / Go wasm / C→Thumb on GBA)
   │  https (invite code → session)
Cloudflare Worker ── D1 (players, saves meta, progress events, challenge results)
   │             └── R2 (optional: code submissions, replays)
   └── LLM provider (interim; agent actions; recorded for replay)
```
Target: agents run in the browser (local models); Worker = accounts, progress, recorded decisions.

## Battle rules approved, tentatively (owner, 2026-10-08)
- core rule (draft 5, `notes/battle-lab.md`): move = a function the Pokémon writes; foe type = its data format; readers from verified hits + Pokédex
- 13 type formats: approved for now
- gym walls: OK with format switching being hard; open to more ideas (options in the briefing doc)
- late game must get harder; calibrate to Misty first: I play in the simulator, then the owner plays organically, then decide
- foes write code, streamed on screen during battle
- open decisions: briefing doc "Code Red briefing: decisions to Misty" (claude.ai Docs)

## Build decisions (owner, 2026-10-08, from the briefing)
1. a miss fails the move completely; the text box says why ("CHARMANDER's code crashed!")
2. code panel under the game (phones) / beside it (laptops): foe's code on top, yours below, both streaming; a toggle hides it
3. turn pace: your code → your move → foe's code → foe's move
4. foes: wild = focus + budget from level, no readers; trainers also know readers for types they've seen; the rival learns your starter's format over the game
5. model/network failure: retry once, then the move behaves like plain FireRed (accuracy roll)
6. memory: each Pokémon keeps its own readers; the Pokédex is shared by the party
- gyms: "badges teach" (Boulder Badge = ROCK + GROUND readers for the party; Cascade Badge = +50 bytes) + "gym trainers teach"; no format-switching aces for now
- defaults from the briefing (until told otherwise): daily cap 1.5M tokens/player; code replayed at a readable pace for the first battles; foe code streams before its move; first battle = tutorial (plain list); I draft Oak's lines + type descriptions

## Code moves in the ROM (2026-10-08, patches/006-code-moves.patch)
- replaces byte battles v1 (damage from script output); damage is plain FireRed again
- when a Pokémon gets to use a move (after sleep/paralysis/confusion/protect checks), the game asks the host and waits (≤30 s); both sides; mailbox `gCodeRedMove` (48 B)
- host replies hit / miss (+ why) / vanilla; no host, timeout or reload = plain FireRed
- a miss: "<name> used <move>!" → "CHARMANDER's code crashed!" (or got it wrong / was too long / didn't write any code); PP still spent
- my call, flag to owner: a hit still rolls FireRed accuracy, so SANDBOX / accuracy and evasion stages keep working
- not asked: STRUGGLE, locked-in turns of multi-turn moves (Thrash, Fly's 2nd turn), link and Pokédude battles
- checked in the simulator: `sim/experiments/code_moves.py` (rival battle under no host / all hit / all miss / mixed; CI seed 0)

## Battle loop in the page (2026-10-08, branch battle-rules)
- `player/src/agents/code-battle.ts`: answers the ROM's code-move requests; prompt/judge/learning from `rules/`; model via the kernel bundle (pi-ai → backend `/v1/ai`, streamed); mock writer with `?agents=mock` or no backend
- `player/src/agents/code-panel.ts`: foe on top, you below; beside the game at ≥980 px, under it below; Code toggle (remembered); first 12 turns replayed at a readable pace (~2 s), 10× shows at once
- memory for now in the browser's local storage: readers per Pokémon (by personality), Pokédex = types battled (counts from the next battle), trainers know the types you've shown them; moves to cloud saves later
- simplification: the rival uses the trainer rule (knows your starter's format from the 2nd battle on), no separate schedule yet
- types with no format yet (ICE, GHOST, DRAGON, DARK) send a plain list
- daily model cap raised to 1.5M tokens per player (worker var)
- journey 11 (real model, shared rules, no aces): 0.90 overall; Brock 0.99–1.0, Misty 0.94–0.95; only dip = Cerulean rival's ABRA (first PSYCHIC) 0.65–0.70; badges change little. Without aces the gyms are not walls: owner decision needed

## The spine (owner, 2026-10-08): every Pokémon is a system
- design doc: Claude Docs "Code Red design: the whole game" (https://claude.ai/code/artifact/954c6976-4b3f-4057-935a-d81f4bc98b73); Moves tab = all 103
- a type is a kind of system: defender face = its data format; attacker face = what its programs do (rules/FAMILIES); every move's spec belongs to its type's family
- Water = streams (not erase): BACKUP → BUFFER, WIPEDISC → DRIP, DROPTABLE → FILTER, HEATSINK → THROTTLE; Bug format = duplicated copy; new formats: Ice snapshots, Ghost invisible string, Dragon kernel hex, Dark signed token
- 31 specs changed (12 names); hard 0% moves simplified (TROJAN, JAMMER, SHARDS, ACID); starters' moves kept easy
- status moves hit the code (owner): stat-stage sum → notch, capped ±2; a notch = ±0.1 temperature, ∓10% budget (rules/NOTCH); ROM reports the sum (mailbox byte 43)
- trainers read every format; wild Pokémon none (owner: the asymmetry is the challenge)
- comments keep counting toward the byte budget (owner); hot memory = a per-Pokémon note typed in the PokÉEG, costs bytes (to build with the cloud store)
- prompt wording: "numbers" / `const nums` (lab 3: first-time 0.29 → 0.52, 78 Buffer hallucinations → 0); NORMAL data needs no reader line
- PokÉEG (owner's name for now): the PC's mind view for every Pokémon owned, System 1 (decision brain) / System 2 (code brain); minds live in the cloud store, the game reaches it through the page
- journey 12 (spine rules): 0.90 overall; Brock 0.99, Misty 0.97; the 'no code' reason rose (49–63 of 2688) → check the raw replies (move table 4 rerun)
