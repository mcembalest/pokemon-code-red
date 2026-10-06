# Backend — Cloudflare Worker + D1 (2026-10-05)

Live: https://code-red-api.macembalest.workers.dev (admin: `/admin`) · secrets set 2026-10-06
Code: `worker/` · deploy: `.github/workflows/worker.yml` · schema: `worker/migrations/`

## Where secrets live
| secret | where | used by |
|---|---|---|
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | GitHub → repo → Settings → Secrets → Actions | deploy workflow |
| `ANTHROPIC_API_KEY` | Cloudflare → Workers & Pages → `code-red-api` → Settings → Variables and Secrets (type Secret) | `/v1/llm` (interim) |
| `ADMIN_TOKEN` | same place; any long random string | `/admin` |
- optional: same names as GitHub repo secrets → workflow syncs them to the Worker on deploy
- token permissions: Workers Scripts Edit, D1 Edit (+ Workers Routes Edit, Zone Read for a custom domain)

## Endpoints
- `GET /health` → `{ok, version, llm, admin}` (llm/admin = whether those secrets are set)
- `POST /v1/join {invite, name}` → `{player, token}`; token = bearer, stored only as sha256
- `GET /v1/me`
- `POST /v1/events {events:[{kind, at?, data?}]}` — ≤200/request, kind `[a-z0-9_.:-]{1,48}`, data ≤4 KB JSON
- `POST /v1/llm` — Anthropic Messages passthrough; model allowlist (`LLM_MODELS` = `claude-sonnet-5-5`), `max_tokens` cap, per-player rolling-24 h token budget (`LLM_DAILY_TOKENS`); every call stored in `llm_calls` (full request/response + hash) for replay
- `GET /admin` — page; `/admin/api/{players,events,llm,invites,invites/revoke}` with `Bearer ADMIN_TOKEN`

## Decisions
- no framework, one file (`src/index.ts`) + static admin page
- CORS: maxcembalest.com, www, `*.vercel.app`, localhost
- invite codes `RED-XXXX-XXXX` (no I/L/O/0/1), case/space-insensitive, `max_uses`, revocable
- lost token = new invite (no recovery yet)
- LLM proxy is interim; target = local models in the browser (design.md → Local models). `llm_calls` doubles as the replay log format

## Tests
- `cd worker && npm test` — real `wrangler dev` (local workerd + D1) + mock Anthropic server; CI runs the same

## Player side (2026-10-06)
- `player/src/backend.ts` — join, session in localStorage (`code-red-session`), event queue (flush 15 s; page hide → `sendBeacon`, token in body)
- `player/src/progress.ts` — reads RAM every 2 s; reports only while the play clock runs (not title screen)
  - `snapshot` (first + every 60 s + on hide): play_s, map, badges, party levels, has_pokemon, champion
  - `map` on change · `badge` on new badge · `first_pokemon` · `champion` · `session_start` on boot
  - first snapshot of a session = baseline (owned badges not re-reported)
- gate: `mount(root, { assets, api })` — `api` default = hosted worker; `false` = no account (dev `index.html` unless `?api=`)
- invite links: `https://maxcembalest.com/pokemon-code-red?invite=RED-XXXX-XXXX` (prefilled, removed from URL after join); admin page shows them
- test: `player/tests/account.py` (Chromium + mock backend; runs in CI)
- lost token (cleared browser / new device) → new invite

## Next
- custom domain `api.maxcembalest.com` (needs the domain's DNS on Cloudflare)
