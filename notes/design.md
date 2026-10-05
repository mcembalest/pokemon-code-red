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
- **Agents → zero API calls (target).** Small agent harnesses + tiny open-source models running in the browser (wasm / WebGPU). Anthropic API = interim backend only, behind the same interface. (2026-10-05)

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
