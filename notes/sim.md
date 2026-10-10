## Mt. Moon leg, status (2026-10-10)
- Owner's bar: the sim beats Mt. Moon at least once. Met: on the doubt ROM (PR #26) CI beat Misty on seeds 0, 1, 2, 4, 5 (L24–26, 74–92 game-min, ~7 min wall); seed 3 died on B2F in CI but got through locally. Before doubt it was seeds 0, 1, 5. Failures move with the RNG, all on B2F.
- These runs have no code-move host: battles are plain FireRed plus doubt (the ROM's roll; `Battle.best_move` picks the strongest move, so the sim is rarely doubted).
- Clef-flash (`@cf/cloudflare/clef-flash`, Cloudflare's 9B decision model: text/JSON/image state + typed choice questions → a probability per option, $0.09/M input tokens) is not needed for this bar. Where it would earn its place: a sim that plays *with* the code-move host (model-written code, misses) where move choice matters more, or navigation from screenshots instead of the map planner.


## Mt. Moon leg (2026-10-09, seeds 0/2/3/4 fail since the names change)
- Fixed: `take_warp` on an arrival tile (step off, step back on); `travel(dest, at=cell)` routes to the area holding `at` (a floor can be several disconnected areas); `heal`/`ready_for_boss`/`journey` survive being stranded off the planner's map (no more `no route … POKEMON_CENTER_1F` crash).
- Still open: from the seed-0 `route4` checkpoint the lead (L18) reaches B2F at 28/51 HP after wild battles, `walk_to(15, 11)` runs into a Rocket grunt and whites out (walk_to returns True from the Pokémon Center), and the loop grinds to L27 before giving up. Needs a leveling/Repel policy for the Mt. Moon leg, not a planner fix. Repro in 15 s: load `build/sim/checkpoints/seed0/route4.state`, call `mt_moon_fossil`.
