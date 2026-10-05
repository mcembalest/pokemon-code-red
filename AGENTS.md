# Code Red working instructions

- Read `README.md` (layout, dev loop) and `notes/` first.
- Game design is the owner's; don't invent mod design. Build foundation and what's asked.
- Game source edits → scoped `patches/NNN-*.patch` before ending a session (`.cache/` is not in git).
- Never track or publish `.gba`, saves, `local/`, `.cache/`, `build/`, proprietary assets. No ROM downloads.
- Core (`core/`) is ROM-agnostic. Don't add ROM-specific addresses/logic to it; put protocols in `player/src/bridge/`.
- Save structs: no layout changes without a migration.
- Before pushing: `make test`; for game changes also `make check` and inspect captures; for player changes run `player/tests/e2e.py`.
- Work on branches; the owner merges to `main` (publishes the player bundle). Website deploys need the owner's OK.
- Backend (`worker/`) deploys only via `.github/workflows/worker.yml` on main. Never commit secrets; worker secrets live on the Worker (Cloudflare dashboard).
