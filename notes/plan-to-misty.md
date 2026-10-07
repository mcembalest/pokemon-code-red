# Plan: invite-ready prototype through Misty (2026-10-06)

Owner goal: before inviting friends, a pretty complete prototype from Pallet Town through Misty (gym 2). Nothing past Cerulean. Think through every Pokémon, move, battle, type and detail in that slice.
Full inventory (from the game data): `notes/inventory-to-misty.md` (57 species, 103 moves, 51 trainers).

## Done means (the friend's journey)
1. Gets an invite link, picks username + password, opens their FireRed file
2. Oak's lab: meets the starter as a coding agent (card), first rival battle
3. Routes 1/22/2: wild battles, catching, first level-ups, Pokémon Center heals
4. Viridian Forest bugs → Brock (Geodude, Onix)
5. Route 3 → Mt. Moon (Rockets, fossil) → Route 4
6. Cerulean: rival → Misty (Staryu L18, Starmie L21)
7. Saves anywhere along the way; resumes on phone or laptop
8. Every battle: player picks the move, the Pokémon writes the code, bytes are spent
9. ~1.5–3 h of play; no crashes, no stuck states, bounded cost

## Decisions only you can make (ordered by what they unblock)
- [ ] **D1 Move system.** 103 moves → ~25 effect families (hit, multi-hit, sleep, poison, stat-down, drain…). Rec: one code-challenge shape per family, flavored per move (SCRATCH vs TACKLE feel different, same skeleton)
- [ ] **D2 Who writes the foe's code?** Every wild/trainer Pokémon writing code each turn = 2 model calls per turn. Rec: wild + regular trainers use the same small model as your Pokémon at their level; rival + gym leaders use the strongest (boss feel)
- [ ] **D3 Status conditions as code ideas.** Rec draft: poison = memory leak (loses bytes each turn) · sleep = process suspended · paralysis = rate-limited (sometimes can't run) · confusion = writes code for the wrong target. Burn/freeze don't occur before Misty
- [ ] **D4 Level → stats + model ladder.** Rec: HP bytes and move-byte budget scale like FireRed; model 3B → Mistral 24B at first evolution (Charmeleon/Ivysaur/Wartortle @16); gym leaders on Qwen Coder 32B (`notes/models.md`)
- [ ] **D5 What carries over at level-up** (no training): stats only for now (agreed). Do you want visible growth too — e.g. its own library of working code?
- [ ] **D6 Type match-ups.** Rec: keep FireRed's chart exactly (players know it); the code only decides hit/crit/miss
- [ ] **D7 Catching.** Rec: unchanged (balls work as in FireRed); the caught Pokémon arrives as a fresh agent at its level
- [ ] **D8 The PC before Misty.** Rec: minimal — view each Pokémon's recent code; no player-written code yet
- [ ] **D9 Copy/tone.** Who writes Oak's new lines + species personas (57)? Rec: I draft, you edit

## Build list (me), in order
- [ ] **M1 Starter battle, real** — kernel in the page (pi-codemode + shim) · Workers AI route in the backend · prompt + outcome → ROM (extend patch 006: miss/hit/crit + bytes) · code window over the battle · both sides write code · tests + sim fixture
- [ ] **M2 Route 1 → Brock** — move families for the early moves · wild battles · catching · level-up stats · Pokémon Center · Brock on the boss model
- [ ] **M3 Mt. Moon → Misty** — remaining families + status conditions · evolution (model step) · Rockets, rival, Misty · Nugget Bridge optional
- [ ] **M4 Accounts + cloud saves** — username/password on invite · one active device · save = SRAM + Pokémon state to Cloudflare · resume on another device (can run in parallel with M2/M3)
- [ ] **M5 Balance + cost pass** — simulator plays Pallet → Misty with agents (mock + real models): win rates, turns per battle, misses per level, seconds per turn, $ per playthrough
- [ ] **M6 Launch prep** — admin view of each player + Pokémon · cost guard (daily cap per player) · kill switch (exists) · mobile check on iPhone · invite links

## Things you might not have considered
- **Turn latency:** two model calls per turn (yours + foe) ≈ 1–4 s; ~150–300 battles to Misty → needs the typing animation to feel like the move, and fast models for routine wild fights
- **Grinding:** players grind on Routes 1/3/4; byte battles must stay quick or grinding gets tedious (option: 10× + auto-hide code after the first few battles)
- **Fumbles near Brock:** a starter that misses a third of the time vs Onix (Rock) could wall players; balance knob = move budgets, Potion counts, or how harsh a miss is
- **Wild Pokémon writing code** gives every Rattata a personality — or cost. Cheaper option: common wild Pokémon reuse a small cached library of their own past code
- **Two-turn moves and fixed damage** (Dragon Rage, Sonic Boom, Bind/Wrap traps, Recover) need their own challenge shapes
- **Moves the player won't see** can be cut: the inventory lists everything up to L25; most players stop around L20–25
- **Abuse:** players can't type to the model directly (no prompt box), so prompt injection is limited to names (player/rival/nickname) → sanitize names in prompts
- **Save-version drift:** a friend's save made before an update must still load (save guard exists; Pokémon state needs a version field too)
- **Telemetry for you:** per battle: model, outcome, bytes, latency, cost → admin page → tells you where friends get stuck

## Your non-decision to-dos
- [ ] Play the current build once on your phone (invite yourself via `/admin`)
- [ ] Skim `notes/inventory-to-misty.md`; mark any Pokémon/moves you want special treatment for (starters, Pikachu, Magikarp, Onix, Starmie?)
- [ ] Pick the first 3–5 friends + a target invite date
