
## Mt. Moon leg (2026-10-09, seeds 0/2/3/4 fail since the names change)
- Fixed: `take_warp` on an arrival tile (step off, step back on); `travel(dest, at=cell)` routes to the area holding `at` (a floor can be several disconnected areas); `heal`/`ready_for_boss`/`journey` survive being stranded off the planner's map (no more `no route … POKEMON_CENTER_1F` crash).
- Still open: from the seed-0 `route4` checkpoint the lead (L18) reaches B2F at 28/51 HP after wild battles, `walk_to(15, 11)` runs into a Rocket grunt and whites out (walk_to returns True from the Pokémon Center), and the loop grinds to L27 before giving up. Needs a leveling/Repel policy for the Mt. Moon leg, not a planner fix. Repro in 15 s: load `build/sim/checkpoints/seed0/route4.state`, call `mt_moon_fossil`.
