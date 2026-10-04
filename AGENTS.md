# Code Red working instructions

- Scope: fast FireRed edit/build/play loop. Pokémon represent coding agents; moves represent tools/skills. Type mapping remains undecided. Do not invent a whole-mod design.
- The user has authorized implementation, commits and pushes to development branches in mcembalest/pokemon-code-red. Keep main untouched. This exception does not apply to other repositories; merges and public deployment still require explicit approval.
- Keep work on an isolated branch; do not discard source edits.
- Use pinned upstream revisions from `upstream.lock.json`; `.cache/pokefirered` is a private ignored build checkout, not a second deliverable repository.
- Capture source edits in scoped `patches/*.patch` files before ending a session. Only patches and development tooling belong in the project Git tree.
- No ROM downloads. Never track/publish `.gba`, proprietary assets, saves, local base dumps, `.cache/` or `build/`.
- For changes, run `make build`; use `make test` when tooling changes and `make smoke` for game changes. Inspect boot captures; nonuniform pixels alone are not proof of correct gameplay.
- Phone route: same cloud conversation now; private Codespaces editor/port 8000 after approval to persist changes. Keep forwards private; the local server is unauthenticated.
