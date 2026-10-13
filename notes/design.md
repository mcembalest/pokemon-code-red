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
- 2026-10-08 evening (owner): byte budget base 300; knowledge tiers = chance a foe reads a format (wild 0, trainers 0.5, leaders/Elite Four/Champion/rival/Giovanni 1, fixed per Pokémon per battle; ROM reports the trainer class, mailbox byte 46); the model token cap is derived from the budget, not a knob; a foe = three dials: decision brain (FireRed AI now, Jaxcalibur-style checkpoints later, strength = Elo), code brain (focus/budget), knowledge (tier)
- 2026-10-08 night: one context budget (owner approved the doc): the reader used this turn and the Pokémon's hot memory are charged against the byte budget; the code must fit in the rest; memory slots retired (a Pokémon remembers any number of readers; each costs only when used); hot memory stored per Pokémon (window.CodeRed.setHot until the PokÉEG exists)
- 2026-10-08 night: accounts + cloud saves live (notes/backend.md): the in-game save = SRAM + minds (readers, hot memory, Pokédex, code history), every version kept; one active device
- 2026-10-08 night: PokÉEG v1, page-side (toolbar button; the in-game PC can't open it yet): every owned Pokémon read from RAM (party `gPlayerParty`, boxes `gPokemonStoragePtr`; `player/src/agents/owned.ts`, substructs decrypted like the sim); per Pokémon: its system (type → format, its moves' family), System 1 (who picks moves, focus, byte budget), System 2 (readers learned, Pokédex readers, the reader line, hot memory with its byte cost, the last 20 turns of code it wrote); `rom.json` now also carries `gSpeciesInfo`, `gExperienceTables` (box Pokémon store experience, not level)
- 2026-10-09 (owner: "as much as possible in-game; code stays in side panels"): PokÉEG in the game, patch 008 (`src/code_red_eeg.c`): PC menu + bedroom PC entry "PokÉEG"; a screen in the item-PC style listing every owned Pokémon (party, then boxes; the ROM reads them itself) and, for the cursor's Pokémon, the mind the page sends through `gCodeRedEeg` (164 B mailbox): "FIRE system: write log · readers · Pokédex · budget · last: ooxoo · note". "Hot memory" opens the page's note editor over the game (B cancels); the page's PokÉEG panel follows the in-game cursor and shows the code. Checks: `sim/experiments/pokeeg.py` (CI), `player/tests/pokeeg.py` step 4 (CI). Format short labels: `FORMATS[t].short`
- 2026-10-09 (owner): names should be simple sensory words that are already computer-flavored (BACKUP, PING, SLICE), not hard-to-picture jargon. 27 renamed: ERRORMSG→ERROR, SEGFAULT→CRASH, RM -RF→WIPE, FORKBOMB→FLOOD, RECURSION→ECHO, PAIRPROGRAM→SYNC, BLUESCREEN→FREEZE, DIALUP→BUZZ, SCREENSAVER→DIM, OBFUSCATE→BLUR, TRACEROUTE→TRACE, KERNELPANIC→MELTDOWN, SPINLOCK→STALL, HIBERNATE→SLEEP, COLDSTORAGE→FREEZER, BOOTDRIVE→BOOT, GROUNDWIRE→GROUND, DOUBLEFREE→DOUBLE, OFFBYONE→SKIP, UNDERFLOW→DRAIN, BACKTRACE→REWIND, DUALCORE→TWIN, SYSCALL→CALL, DEEPFAKE→SMUDGE, AUTOSCALE→SHRINK, HONEYPOT→LURE, BOTNET→SWARM (STATIC was wanted for DIALUP but is a JavaScript keyword → BUZZ). Specs unchanged.
- 2026-10-09 (owner): bytes are the universal medium — sound and pixels are bytes too. Payload moves (prototype on ERROR = sound, FLASH = image): the code *makes* bytes instead of answering; the GBA plays/draws them; a hit = the bytes satisfy the move's shape; the target's type is the format the payload must be delivered in. Not a family: a property any move can have.
- 2026-10-09 (owner: "be UX-minded on in-game screens; tabbed pages; clarify phrasing first"): PokÉEG mind window → four tabs (←/→ or L/R): SYSTEM "FIRE system / Data arrives as: write log" · READERS "Learned: Water, Rock / Pokédex: Normal, Rock, Ground" · CODE "Budget: 350 bytes a turn / Last 5 turns: 4 hit, 1 miss" · NOTE the note itself (page wraps it to two lines) + "Press A to change it". A on a Pokémon jumps to NOTE; A there edits on the page. Mailbox v2 (260 B) adds the reader name lists. Help system is off on the screen (L/R).
- 2026-10-09 payload moves built (patch 009, `src/code_red_payload.c`; page `bridge/payload.ts`): on a hit the page drops the bytes into `gCodeRedPayload` (540 B; EWRAM is ~120 B from full after it, so the page delivers GBA-ready bytes: signed 8 kHz samples / 4bpp tiles) and the game plays them through the cry player (looped for 36 frames) or draws a 32×32 16-grey sprite over the target for 48 frames. Lab (Llama 3.2 3B, 60 samples each): v1 free-form specs 0/120 (verbose code over budget, data[0] confused with data.length); v3c recipe specs: ERROR 57% (first 43%, with a reader 70%) ≈ answer moves; FLASH 8% (over budget, first-number confusion) — FLASH is HM05, not reachable before Misty, left in as the picture prototype. Open: specs that leave the model room to be creative cost too many bytes for a 3B model; a bigger model or a payload-only budget would change that.
- 2026-10-09 night (owner: bigger model for payload turns): payload moves now go to Qwen2.5-Coder-32B (`PAYLOAD_MODEL`; worker allowlist; the page picks the model per move; ~2.2 s a turn). Lab, 40 samples each: recipe specs ERROR 98% / FLASH 83%; free-form "your own pattern" specs on the same model ERROR 68% / FLASH 38% (lengths off by one; "dark" drawn at 100–200). Shipped: recipes on the 32B. Flagged: creative specs are a lab item until a check that forgives length and a clearer "dark = below 50" wording are tried.
- 2026-10-09 night: four more payload moves on the 32B — BUZZ (2 kHz), FEEDBACK (667 Hz), DIM (a soft 500 Hz hum: 160/96) as sounds, SPARK as a picture (black with a bright bar). Lab (40 each): SPARK 95%; BUZZ 45% / DIM 65% / FEEDBACK 58% with a 512-sample cap, which was the GBA buffer, not a game rule — the page clips, so the check now only fails "too short": re-judged BUZZ 100% / DIM 93% / FEEDBACK 88%. Six payload moves total.
- 2026-10-09 evening (owner): only wild Pokémon use a System 1; a Pokémon in your party uses the move you call, but it can disagree to the exact proportional extent your pick is misaligned with its own System 1 choice, and that fades with badges (your alignment with your Pokémon). Built as **doubt** (`rules/doubt.mjs`, my call, reversible): its System 1 today = whatever hits hardest now (power × accuracy × effectiveness × STAB); doubt = (1 − yourScore/itsScore) × (1 − badges/8); doubt becomes a negative notch (−1 at ≥25%, −2 at ≥75%: hotter writing, smaller budget) — it still uses your move. Never in the tutorial battle; nothing to doubt when it has no damaging move. The code panel says "doubts you −1 (wanted EMBER)"; the PokÉEG has an INSTINCT tab: "Instinct: whatever hits hardest. / Trusts your picks: 25% (badges)" (mailbox v3, trust byte). Open: whether doubt should sometimes override the move (FireRed disobedience style) — not built.
- 2026-10-10 (owner): **doubt overrides the move**, superseding the notch above. When your call looks weaker to its instinct, your Pokémon uses its own pick with chance ½ × (1 − yourScore/itsScore) × (8 − badges)/8 — "CHARMANDER doubted your call!", then "CHARMANDER used SCRATCH!". Same rule in every battle, gyms included (FireRed/Red had disobedience in gyms too); the tutorial rival battle too. It costs only the move: no shaking, no smaller budget; the code is written for the move it actually used. The ½ cap is the owner's pick (2026-10-10) so status and payload moves (ERROR = Growl scores 0) stay usable at 0 badges: a useless-looking call is doubted 50% of the time with no badges, 44% with one, 0% with eight. The ROM rolls it (patch 006, `CodeRedDoubts` from `IsMonDisobedient`, before FireRed's traded-Pokémon check), so it works without the page; the mailbox's byte 47 `calledSlot` tells the page which call it doubted ("SLICE → … · doubted your ERROR"). `rules/doubt.mjs` mirrors the formula (`doubtChance`, `maxDoubt`). PokÉEG INSTINCT tab: "Instinct: whatever hits hardest. / Doubts your calls: up to 44%" (byte 260 is now doubtMax, 0–50). Measured in the ROM: `sim/experiments/doubt.py` (GROWL over SCRATCH: 50% / 23% / 0% at 0 / 4 / 8 badges, n=60). Battle text "doubted your call!" is my wording — flagged for the owner.
- 2026-10-10 evening (owner): **friendship, not badges, decides how much it listens** — "Makes sense for friendship to actually be the thing that we use to determine how much a Pokémon listens to your calls not some new separate doubt measurement". Chance = ½ × (1 − yourScore/itsScore) × (1 − friendship/255), FireRed's own friendship (0–255; starters begin at 70, so a useless-looking call is doubted at most 36% at first; it falls as friendship grows by walking, levelling, vitamins; at 255 never). Badges play no part. ROM: `CodeRedDoubts` reads `gBattleMons[].friendship` (two-step integer maths: scores reach 150000). The PokÉEG INSTINCT tab works its number out from the Pokémon's own friendship (mailbox byte 260 unused now); the page panel reads friendship from RAM (`OwnedReader`, which now also decodes nature, IVs and EVs). Measured: `sim/experiments/doubt.py` at friendship 0 / 70 / 255 with all eight badges set.
- 2026-10-10: **the count dot is gone, the count rule stays.** A payload move's first number is still the foe's count (it is what makes the code read the foe's format, so type matters for payload moves too), but it is checked, not played or drawn: the page hands the GBA the rest (`rules/turn.mjs` verdict). A picture repeats its last pixel to keep 1024. FLASH/SPARK no longer have a near-black dot in the top-left corner. (Dropping the count entirely would have made payload moves ignore the foe; not done.)
- 2026-10-10 (owner: "expressive, frankly artistic/musical … the pixelated animalistic sounds of the 90s games"). **Payload moves v2** (`rules/payload.mjs`, patch 009 v2):
  - Sounds: up to 4096 samples at 8 kHz (~0.5 s), played once through the cry player. Game Boy-style: square waves whose duty wobbles (the nasal, creature-like timbre), pitch slides, grit, stutter, envelopes. ERROR = a glitchy growl sliding down; BUZZ = a bird trill; FEEDBACK = a rising whine with vibrato; DIM = a soft three-note lullaby.
  - Pictures: 4 frames of 32×32, color numbers 0–15 (0 see-through), drawn over the foe at 2× (popping in from 1.5×), in the move's 16-color palette (FLASH ember → white-hot; SPARK night blue → electric → white). FLASH = a starburst that grows and breaks into sparkles; SPARK = a flickering jagged bolt.
  - The checker judges character, not exact numbers (falls / trills / rises / three notes; grows / crosses; it must fade, be loud enough, keep a shape). Fractions round, out-of-range values stick to the edge.
  - **Voices (my call, flagged):** every species has its own voice (`voiceOf(name)`: pitch ×0.6–1.7, duty, wobble, stutter, lullaby motif; FLASH rays/growth; SPARK jaggedness/glow), like each species' cry in the old games. The prompt shows a worked example in that voice and invites the Pokémon to make it its own. Without the example the 32B model hit 2% (flat, unshaped synths); with it, 126/144 across 8 species (ERROR 24/24, FLASH 23, FEEDBACK 22, BUZZ 21, SPARK 21, DIM 15 ≈ Sing's own 55% accuracy). Latency ~4.8 s a turn (longer code). Variety: mostly the voice plus the model's own tweaks; a few genuinely new shapes (a ring of embers, a spiky burst).
  - Verified on the GBA: the m4a engine plays each sound at 8001 Hz through the whole sample (`sim/experiments/payload_audio.py`); the starburst animates over the foe (`sim/experiments/payload.py`); 14.8 KB of heap stays free with the 4 KB mailbox and the party/bag open.
  - Review page with every reference and model output, playable: https://claude.ai/artifact/RVmuG2Cm5QKQxDfbbeM5Wr
- 2026-10-10 evening (owner): **the PokÉEG becomes a brain scan**, display only, built from existing concepts ("weave together existing concepts between the original games and our new system one model … we don't have to introduce a bunch of new arbitrary stuff like focus"; "packaging it visually in that cool Game Boy style art … Very brain scan looking"). In the game (patch 008) and on the page (`player/src/agents/scan.ts`, same picture from the same numbers): a top-down brain in a skull, five glowing lobes = the five stats a nature touches (ATTACK, DEFENSE left; SP. ATK, SP. DEF right; SPEED at the back; the raised one glows bright, the lowered one dims, all breathe by palette), twelve electrodes = IVs (two per stat; ≥26 bright, ≥16 mid), and four scrolling channels: BOND (friendship: a slow wave, taller and steadier as it grows), WIRING (six tones, one per IV), TRAINING (six bursts, one per stat's EVs; untrained = a faint buzz), MEMORY (last ten turns: spike = hit, sag = miss). Seven tabs (L/R or ←/→): NATURE, WIRING, TRAINING, BOND (friendship, instinct, "Doubts your calls: up to N%"), CODE (its type's system, data format, budget), MEMORY (readers learned, Pokédex readers, last turns; the page also lists recent code), NOTE (hot memory; A edits on the page). The first four come from the Pokémon itself, so they work without the page. Focus is no longer shown. Wording (tab names, "its lobe glows/dims", "Wiring (IVs), set at birth") is mine — flagged for the owner. Runs at a full 60 fps in the ROM (row fills a u32 at a time; FillWindowPixelRect halved the frame rate).
- 2026-10-11 (owner): **no readers** — "remove the concept of a reader entirely … forced to be memory/instinct how to handle data". Why it came up: the rehearsals showed foes landing 54% vs yours 95%, and the whole gap was readers (with one, foes landed 97–100%; without, 40–46%; vs a Poison-format target 25%). Now: no Pokédex readers, no badge readers (BOULDER gives nothing new — flagged), no foe knowledge tiers. Your Pokémon reads a format by **instinct** (the prompt's plain description and example) or from **memory**: the reading line of its own past hit on that format (verified, as learned readers were), plus the note you pin. Owner picked "its own past hits + your note" for memory and "everyone pure instinct" for foes (bosses are harder only by FireRed stats). PokÉEG MEMORY: "Remembers: Water, Rock" or "Reads every format by instinct."; the page panel no longer shows the canonical reading line. (2026-10-11, later: `partyDex`/`foeDex`/`KNOWLEDGE`, the reader-slot knobs and the journey lab that used them were removed; nothing else called them.)
- 2026-10-11 (owner): **memory is code, in three kinds of bytes** — "bytes saved by the pokemon on its own in hot memory, bytes the user can write in text in the EEG, and then there are working memory bytes that are carried move to move within a battle but die when a battle is over … it would be cool if the pokemon's bytes were helpful bytes! Not just text". Built (`rules/memory.mjs`): **working memory** = the `my…` helpers its code defines (any depth; only from a hit, and only if it checks out: it must compile, and a myRead<Format> helper must read its format's example and this turn's data right — v2/v3 kept unchecked helpers and the runs sank to 9–35% hits), defined before its next turn's code so it can call them, capped at a quarter of the turn's budget (oldest drop first; v1 at half measured 4–15% hits), gone when the battle ends; **long-term memory** = helpers kept between battles: at the end of a battle each of your Pokémon that kept something consolidates (one model call: "you can keep at most N characters…"), keeping only what compiles and fits; it can lose things (owner: yes); a failed call keeps the old memory; cap = 80 + 5 × level (105 at L5, 280 at L40: a level-5 Pokémon keeps about one reader — 40 + 5 × level was too small for even one); **your note** = hot memory as before. Your note costs bytes every turn; a helper costs its size only on a turn its code calls it (v2 charged everything carried up front and a level-6 Pokémon ran out of room: battles stalled). The Pokémon decides what to keep (owner: "pokemon accumulates its own working memory"). Old saves: learned readers become `myRead<Type>` helpers once. Foes carry none. PokÉEG MEMORY: its helpers by name (in game) and as code with bytes used of its cap (page).
  - Measured iterations (2 seeds each, real models): v1 (helpers from any code that ran, all carried bytes charged) 4–15% hits; v3 (charged only when called) 9–35%; v4 (only from hits, readers checked) 20–39%, seed 0 beat Brock; the sim also had a cursor bug (stuck on an empty move slot once PP ran out) that made v2–v4 crawl — fixed. v4's crashes: the model called whatever reader it carried (myReadFlying on BUG data). v5: **recall by format** — the prompt shows only the reader for this turn's format plus non-reader helpers; a reader must be named for its format (myReadData is not kept); the offer to keep one shows only while it has none for this format, never for plain lists.
  - v5 measured (2 seeds): 44–59% hits; seed 1 beat Misty, seed 0 lost in Mt. Moon; with a remembered helper 64–73%, without 32–51%; ~470k tokens a run. POISON is the hard format by instinct (19%, foes alike); a remembered POISON reader hit 27 of 27. v6: a reader that checks out is kept even under a wrong answer (the check, not the hit, verifies it; other helpers still only from hits); the "you carry no X reader yet" line replaces the optional offer the model read as "it exists" (66 crashes calling an undefined myReadPoison, stub helpers); working memory ≥ 200 bytes (a quarter of 350 held one reader).
  - v6 measured: seed 0 69% hits, beat Misty in 20 min (264k tokens); seed 1 46%, lost in Mt. Moon: at L22+ (calm, low temperature) it wrote the same wrong POISON reader 236 turns running — it never hears how its last move went. v7: **working memory remembers the last turn** — one line in the next prompt ("Last turn: PING on POISON data missed (returned 5, needed 4). Do it differently."), costs its bytes, gone with the battle. The page's code panel shows what it recalls and what it kept each turn; the PokÉEG MEMORY tab says what it kept and let go after its last battle.
  - v7 measured: both seeds beat Misty (the first time since readers went), but hits fell to 40–50% and "over budget" doubled: the last-turn line ran 100+ bytes ("returned [..], needed [..]") and was charged, so a shaken level-6 Pokémon with a called reader had ~140 bytes left — too few for a payload move. v8: the line is short (values clipped) and free — it is what just happened to it, not bytes it chose to carry (my call; flagged).
- 2026-10-11 (owner: "Proceed to lt surge"): **the game runs through Lt. Surge.** Sim route after Misty (`routes.to_surge`): Nugget Bridge (rival, five trainers), Bill's cottage (he is the Clefairy; the PC runs the cell separator; `talk_to` now uses live NPC positions), south through the robbed house's back door (cut trees and boulders are planner obstacles now, so the route goes the way the game intends), the Underground Path (the Saffron gates avoided), Vermilion, the S.S. Anne (the rival outside the captain's office, HM01), CUT (taught by a direct party write — the TM-case menus are long to drive; used from the tree's own "cut it down?" prompt; the tree grows back on every map reload, so it is cut on the way in each time), the gym (switch cans read from VAR_TEMP_0/1; the Gentleman met from below so he doesn't block the doorway; a heal before the leader). **18 moves the stretch uses had no code** — Cut CUT, Thunderbolt SPIKE, Shock Wave SHORT, Bubble Beam STREAM, Confuse Ray PEEK, Constrict CLIP, Faint Attack BACKDOOR, Fire Spin HOTLOOP, Flamethrower OVERWRITE, Mud Shot FLOOR, Odor Sleuth SNIFF, Pay Day PAYOUT, Protect FIREWALL, Rain Dance DRAIN PIPE, Roar ROTATE, Stomp STOMP, Take Down SHUTDOWN, Vice Grip CLAMP (names mine, flagged); `scripts/move_names.py` regenerates patch 007 from the rules. **Bug found:** FireRed's gTypeNames are six letters (ELECTR, PSYCHC), so Electric and Psychic foes were sending plain lists; `formatOf` maps them now. Measured (2 seeds, real models, v8 memory): both beat Lt. Surge at L31–32 in 31–34 min, 650–680k tokens a run; hits 42–46% (POISON 17–27%: most of the route is Zubat and Weedle), foes 44–46%.
- 2026-10-11 (owner: "Make sure site is live with most recent changes then continue to erika", then "Stop at Erika"): **the game runs through Erika; Erika is the release line.** Sim route after Lt. Surge (`routes.to_erika`): back north to Cerulean, Route 9 (a tree), Rock Tunnel in the dark (no Flash: the planner walks it blind), Lavender, Route 8 and the east–west Underground Path (Saffron's gates are shut), Celadon (the gym hides behind a tree at (40,35); another inside at (6,8); both grow back on every reload). **34 moves the stretch uses had no code** — Barrage SPAMMER, Horn Drill KILL, Spit Up DUMP, Stockpile CACHE, Swallow PURGE, Tri Attack TRIPLE, Uproar NOISE, Flame Wheel HOTSWAP, Heat Wave THERMAL, Hydro Pump FIREHOSE, Mega Drain SIPHON, Giga Drain HARVEST, Solar Beam SUNBURST, Synthesis REGROW, Ingrain ROOT, Aromatherapy CLEANUP, Mud Slap SMEAR, Dig TUNNEL, Bone Club CLUB, Bonemerang BOOMERANG, Sand Tomb QUICKSAND, Feather Dance DAMPEN, Psychic PROFILE, Agility TURBO, Calm Mind IDLE, Meditate LINT, Dream Eater DAEMON, Future Sight FORECAST, Lick SNOOP, Night Shade SHADOW, Shadow Punch GHOSTWRITE, Spite SPITE, Rock Blast BUCKSHOT, Dragon Breath FLAMEOUT, Twister CYCLONE (names mine; owner: "Moves look ok for now"); 156 moves have code in all. Take 1 (2 seeds, real models): seed 0 beat Erika at L41 in 45 min, 857k tokens, 53% hits; seed 1 reached Celadon and **lost to Erika**, whited out, and the sim crashed (it looked for Erika in the Pokémon Center). Two sim fixes: a lost leader battle is retried from the Pokémon Center (three tries, as a player would), and the move chooser weighs each move by how often its code has landed on foes of these types this run (seed 1 kept calling CUT on POISON data at 6% hits, like a player who never changes a losing call). Take 2: seed 1 beat Erika in 43 min, 720k tokens, 59% hits (L39 at Erika, PING 89%); seed 0 died to a sim bug (`take_warp` rewound the game through a battle a Rocket grunt started, so the code brain was asked the same move 210 times at one frame: fixed, and a rewound request is answered from memory now). Take 3: seed 0 beat Erika in 36 min, 605k tokens, 60% hits, every leader in one challenge. Yours by format (both seeds): POISON 35–48%, GRASS 43–63%, BUG 54–60%, FLYING 63–86%, PSYCHIC 23–46%, NORMAL/ROCK/GROUND 100%; foes: POISON 14–19%, GRASS 70%. A run to Erika costs 600–720k of the 1.5M daily tokens a player gets. Open (owner): POISON is the hard format by instinct for everyone — leave it (Erika's gym is half Poison, so it is where a player feels it), or soften the format's note in `rules/formats.mjs`.
- 2026-10-12 (owner: "zero daily caps, I am happy to pay"; "fix all 9 items"): the per-player daily token cap is off (`AI_DAILY_TOKENS = 0`; a number restores it); the admin page has a **code report** per player (hits by format and move, miss reasons, fallbacks, memory use, the last misses with their code) from the `code_move` events the page already sent; a refused model call says so in the panel instead of "connection lost"; a **nightly real-model rehearsal** (one seed, rotating) runs from `rehearsal.yml`'s schedule, results as `nightly-<date>-<sha7>` on the release; CI asks the site to pin a new bundle at once when a `SITE_TOKEN` secret exists. **Boulder Badge gives +30 bytes** (my call, flagged: it taught readers before; Cascade gives 50). Erika vs a lone Grass starter is the player's team to build, not the game's problem (owner).
- 2026-10-12 (owner: "refining and cleaning … things that would look wrong and sloppy to seasoned Pokémon players"): **every move a player can meet before Erika has code** — `scripts/inventory.py` reads the decomp (wild encounters, trainers on the route's maps, level-up moves to L45, the TMs found or sold on the way) and found 56 without: Attract, Body Slam, Hyper Beam, Thunder, Rest, Light Screen, Sludge Bomb, Explosion, the Game Corner prize TMs… (and Vice Grip, which the Surge notes named CLAMP but never got a row). 212 moves now; CI fails if a new gap appears. The summary screen keeps FireRed's own move descriptions (owner: "keep firered style"; a generated "Returns the first 3 numbers." version was tried and dropped the same day). Owner, same day: no foe handicap; doubt stays as is for now — but "whether the doubt is calibrated and whether the Pokémon's initial System 1 models are at all the coherent aspect of the game I would love them to be" is an open conversation; POKéEG spelling ok; move names are mine to decide as long as `rules/moves.mjs` → `TABLE` stays the one control panel. **The prototype "Code" PC entry is gone**: every PC in the game had offered "Run JS stats calculation → JS result: 318" (the first game↔browser mailbox, 2026-10-04); the calc mailbox, the page's scratchpad REPL and its tests went with it. In-game spelling follows POKéDEX: **POKéEG** in the PC menus and on the screen's title (the page keeps PokÉEG; flagged).
- 2026-10-13 (owner, on the road: "I wanted audio moves to be cool and synthy and at the same time sound like the old Pokémon moves … be wise and dissolve problems"). Recorded what a player heard (`sim/experiments/move_sounds.py`, battle music stopped, animations on): the payload played during the "X used ERROR!" text, then FireRed played its own move sound right after — two sounds, the synth cut off by the original; and a 0.5 s buffer could never be SING's 4-second tune. **Sound moves now play inside their own animation, in place of FireRed's sound** (patch 009): on a hit the payload is armed for the move (`gCurrentMove`) and spent at the next move; while that move's animation runs, a cry it plays is the payload (`PlayCryInternal`), and a sound effect it plays is re-voiced (`PlaySE…`: a RAM copy of the song header whose voicegroup is the payload's wave, every voice keeping its own envelope). Two payload kinds: **sound** (one-shot, ≤4096 samples at 8 kHz: ERROR's growl, played as GROWL's double cry) and **voice** (one cycle of a wave, 16–256 samples, looped; C4 at key 60 = 261.6 Hz × 512 × N in m4a's units, measured): DIM sings SING's own tune (the same pitches, checked: 393 / 706 / 623 Hz), FEEDBACK rings SUPERSONIC's rings, BUZZ blows SONIC BOOM's whooshes — FireRed's notes, rhythm and timing in the Pokémon's synth voice. Voice checks are character: soft (DIM: up once and down once, no jumps), bright (FEEDBACK: a pulse high under 30% of the cycle), rough (BUZZ: crosses 128 six times or more); every voice centered on 128 and loud enough. With battle animations off the sound plays at once, as before. CI (`sim.yml`): every code recording differs from FireRed's, starts when FireRed's does (±50 ms), and SING's notes match within 3%.

