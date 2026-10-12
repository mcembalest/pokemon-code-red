# notes/

Working notes. Outline + links + quotes. Not docs. Dated files are snapshots of that day and may describe things since changed; `design.md` is kept current.

| file | what |
|---|---|
| [design.md](design.md) | goals, decisions, open questions, risks — the game itself; every owner decision with the date, and what each change measured |
| [moves.md](moves.md) | every type's data format and every move's code (generated: `make names`) |
| [types.md](types.md) | the type ↔ storage/security concept table (owner's typechart) |
| [sim.md](sim.md) | the dress rehearsals: real models through the sim, a fresh account on the live site |
| [battle-lab.md](battle-lab.md) | 2026-10-07: the battle rules' first drafts measured in the lab (readers and slots there are gone since 2026-10-11) |
| [strategy.md](strategy.md) | 2026-10-08: the move-choice strategy lab (`models/strategy/`) |
| [state-2026-10-04.md](state-2026-10-04.md) | what exists, where (branches, commits, files) |
| [fragility-audit.md](fragility-audit.md) | weak points in browser / runtime / dev cycle, with evidence |
| [memory-budget.md](memory-budget.md) | measured RAM / ROM / save numbers from vanilla build |
| [foundation-plan.md](foundation-plan.md) | proposed order of work to make the foundation robust |
| [foundation-2026-10-04.md](foundation-2026-10-04.md) | what was done + verified for that plan |
| [bridge-v2.md](bridge-v2.md) | sketch: general game <-> browser channel |
| [sim-2026-10-05.md](sim-2026-10-05.md) | headless simulator: power-on -> Misty, 6/6 seeds |
| [backend.md](backend.md) | Cloudflare worker + D1, secrets, endpoints, player-side tracking |
| [agents.md](agents.md) | agent framework v0, battle prototype, sim↔browser states |
| [overnight-2026-10-06.md](overnight-2026-10-06.md) | what shipped overnight, what to try, what's unverified |
| [plan-to-misty.md](plan-to-misty.md) | invite-ready prototype through Misty: done-means, decisions, build list |
| [inventory-to-misty.md](inventory-to-misty.md) | every species, move, trainer up to Misty (generated from the game data) |
| [models.md](models.md) | Workers AI model probe on the starter moves |
| [sources.md](sources.md) | external links |

Conventions
- `G:` = game repo `mcembalest/pokemon-code-red`
- `S:` = site repo `mcembalest/maxcembalest.com`
- `game@1189974` = `integration/code-red-scratchpad-naming-20261004` head
- `site@408c921` = `feat/code-red-player` (PR 6) head
