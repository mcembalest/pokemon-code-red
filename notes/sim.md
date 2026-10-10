## Dress rehearsal (2026-10-10, .github/workflows/rehearsal.yml)
- Half 1, `sim/rehearse.py`: the real models write every code move (both sides; `sim/brain.ts` runs the page's own CodeBattle in Node). Power-on → Misty reached on seeds 0, 1, 2. Seed 0: 581 code turns, your hits 92%, foes 54%, 207k tokens, ~9 min of model waiting (direct Workers AI, 0.5 s median); seed 1: 459 turns, 94% / 60%, 150k tokens.
- Half 2, `player/tests/rehearsal_live.py`: a new account on the live site (one-use invite minted and revoked by the workflow): join, recovery code, ROM, starter card, rival battle, PokÉEG, in-game save → cloud, Brock and Misty from sim states. All steps pass; code moves through the live backend take 2.2 s median, 2.8 s p90.
- Found: FireRed v1.1 files were refused (fixed, #29); the site's auto-pin runs every 4–6 h, not every 15 min; ERROR over budget at L5–9 (examples slimmed, #30); the models package test went stale with #28 (fixed in #30).

## Mt. Moon leg, status (2026-10-10)
- Owner's bar: the sim beats Mt. Moon at least once. Met: on the doubt ROM (PR #26) CI beat Misty on seeds 0, 1, 2, 4, 5 (L24–26, 74–92 game-min, ~7 min wall); seed 3 died on B2F in CI but got through locally. Before doubt it was seeds 0, 1, 5. Failures move with the RNG, all on B2F.
- These runs have no code-move host: battles are plain FireRed plus doubt (the ROM's roll; `Battle.best_move` picks the strongest move, so the sim is rarely doubted).
- Clef-flash (`@cf/cloudflare/clef-flash`, Cloudflare's 9B decision model: text/JSON/image state + typed choice questions → a probability per option, $0.09/M input tokens) is not needed for this bar. Where it would earn its place: a sim that plays *with* the code-move host (model-written code, misses) where move choice matters more, or navigation from screenshots instead of the map planner.


## Mt. Moon leg (2026-10-09, seeds 0/2/3/4 fail since the names change)
- Fixed: `take_warp` on an arrival tile (step off, step back on); `travel(dest, at=cell)` routes to the area holding `at` (a floor can be several disconnected areas); `heal`/`ready_for_boss`/`journey` survive being stranded off the planner's map (no more `no route … POKEMON_CENTER_1F` crash).
- Still open: from the seed-0 `route4` checkpoint the lead (L18) reaches B2F at 28/51 HP after wild battles, `walk_to(15, 11)` runs into a Rocket grunt and whites out (walk_to returns True from the Pokémon Center), and the loop grinds to L27 before giving up. Needs a leveling/Repel policy for the Mt. Moon leg, not a planner fix. Repro in 15 s: load `build/sim/checkpoints/seed0/route4.state`, call `mt_moon_fossil`.
