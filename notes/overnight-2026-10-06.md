# Overnight 2026-10-06

## Live now
- backend `https://code-red-api.macembalest.workers.dev` @ `5e81dc2` — `/health`: llm ✓ admin ✓; model allowlist = `claude-sonnet-5-5` only
- site `S@520e828` (Vercel: success) pins `player-0d16f8e90c32-5e81dc2` → **invite screen is on** for everyone
  - you: `/admin` → create code → open its link (`…/pokemon-code-red?invite=RED-…`)

## Merged (G)
| PR | what | CI |
|---|---|---|
| #2 | invite gate + progress tracking (notes/backend.md → Player side) | ✓ incl. new `account.py` |
| #3 | agent framework v0 + battle prototype (notes/agents.md) | ✓ incl. new `agent_battle.py` (rival battle won, mock brain) |

## Try (on phone or laptop, after joining)
- `maxcembalest.com/pokemon-code-red?agents=on` → get into a battle → tap **Agent** → starter picks moves with Sonnet 5.5, thought box over the game
- `?agents=mock` = offline greedy baseline (no API calls)
- admin → player row → events: `snapshot`, `map`, `badge`, `agent_decision` (thought, ms, fallback)

## Not verified from here
- Sonnet call end-to-end (sandbox can't reach workers.dev) — if the box shows `(fallback)` with “…”, `/admin` events have the error
- live site page itself (Vercel says deployed)

## Found
- sim save states load in the browser (same mGBA core) → `sim/make_states.py` fixtures for browser tests
- site auto-update cron (`*/15`) runs hours late (GitHub schedule) — last runs 18:01, 22:55, 02:43 UTC; pinned `5e81dc2` by hand with the same steps (sha256 verified). Fix = game CI pings the site repo (`repository_dispatch`) → needs a fine-grained PAT (site repo: contents write) as a game-repo secret
- worker deploy smoke test could pass on the old version → now waits for the new version string

## Decisions taken (reversible)
- invite required to play on the site (backend down → existing sessions still play; new joins fail)
- lost browser storage = new invite (no recovery)
- prototype battle agent: moves = actions; B (not A) to advance battle text
