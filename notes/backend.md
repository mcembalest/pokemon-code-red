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
- `POST /v1/llm` — Anthropic Messages passthrough; model allowlist (`LLM_MODELS`), `max_tokens` cap, per-player rolling-24 h token budget (`LLM_DAILY_TOKENS`); every call stored in `llm_calls` (full request/response + hash) for replay
- `GET /admin` — page; `/admin/api/{players,events,llm,invites,invites/revoke}` with `Bearer ADMIN_TOKEN`

## Decisions
- no framework, one file (`src/index.ts`) + static admin page
- CORS: maxcembalest.com, www, `*.vercel.app`, localhost
- invite codes `RED-XXXX-XXXX` (no I/L/O/0/1), case/space-insensitive, `max_uses`, revocable
- lost token = new invite (no recovery yet)
- LLM proxy is interim; target = local models in the browser (design.md → Local models). `llm_calls` doubles as the replay log format

## Tests
- `cd worker && npm test` — real `wrangler dev` (local workerd + D1) + mock Anthropic server; CI runs the same

## Next
- player client: invite gate UI, token in IndexedDB, event queue (session_start, badges/flags/map from RAM via bridge)
- custom domain `api.maxcembalest.com` (needs the domain's DNS on Cloudflare)
