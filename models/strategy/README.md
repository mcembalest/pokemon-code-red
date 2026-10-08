# Strategy lab

A fast, simplified FireRed (Gen 3) singles engine with the Code Red rule on top. It answers:
does thinking about moves pay off, and which mechanics would make it pay off more?

- `extract.py` → `kanto.json` (not tracked: generated locally from the decomp): species, learnsets, moves, type chart and trainer parties, read from the
  pinned decomp (`.cache/pokefirered`)
- `codered-moves.json`: FireRed move → Code Red name (from `rules/moves.mjs`)
- `move-table.json`: P(code right) per Code Red move, first time vs known reader (lab move table, real model)
- `engine.py`: the battle (damage, accuracy, stat stages, status, trapping, drain…) + the code check
- `policies.py`: random · firered (rough trainer AI) · power (strongest hit) · code (expected hit with its
  coding odds) · search (rollout planner)
- `arena.py`: one matchup, all policy pairs
- `depth.py`: strategy depth = win rate gap between the planner and "strongest hit", per gym, starter, rule variant

Not FireRed-exact: no items, weather, abilities beyond the starters' pinch boost, or switching. Good enough to
compare policies and rule variants; not a replacement for the emulator simulator (`sim/`).
