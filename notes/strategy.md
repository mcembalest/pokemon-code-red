# Strategy lab, 2026-10-08

Briefing for the owner: Claude Docs "Code Red: battle strategy briefing" (https://claude.ai/code/artifact/136f94a3-fc6a-4962-a22f-94673d20c99b).
Code: `models/strategy/` (engine, policies, planner, tiny net). Real-model move table: `models/lab/moves.mjs` → `models/strategy/move-table.json`.

## Real model, game prompt, all 103 moves (2,472 tries)
- first time 0.58, known reader 0.76; easiest ERRORMSG/SURGE/KERNELPANIC (1.0 first), hardest TROJAN/RM -RF (0 first)
- misses: wrong 389, over budget 218 (mostly right code + comments; 1 of 1,659 hits had no comments), crashed 193 (164 = Node Buffer `readUInt8`), no code 13
- cheap fixes (owner's call): "numbers" instead of "bytes"; comments outside the budget

## Simulator findings (single starter vs the leader's party, no items/switching: compare, don't trust absolutes)
- plain FireRed rules: planner ≈ "strongest move"; coding-odds-aware choice ≈ same
- leader knows your format: Squirtle–Brock 0.49 → 0.37, Bulbasaur–Misty 0.42 → 0.10 (difficulty dial)
- stat moves also shift code focus ("add", log-odds 0.4/stage): planner Squirtle–Brock 0.44 → 0.86 (Withdraw on Geodude, then Bubble Onix); needs a cap
- tiny policy net (1.9k params, 100k REINFORCE battles, 2 CPUs) = greedy play; misses the setup trick. Jaxcalibur-scale needs a JAX engine + GPU

## Pending owner decisions (briefing table)
1 status moves hit code · 2 gym walls via leader knowledge · 3 leader brains · 4 odds in the move menu · 5 prompt fixes · 6 trained brain later
