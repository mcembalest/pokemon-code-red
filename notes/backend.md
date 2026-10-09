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
- `POST /v1/join {invite, name, username, password}` → `{player, token, active}`; token = bearer, stored only as sha256; username `[a-z0-9_]{3,20}` (lowercased, unique), password ≥ 8 chars (PBKDF2-SHA256 100k, per-player salt); this device becomes the active one
- `POST /v1/login {username, password}` → `{player, token, active}` — new session that takes over as the active device; 10 failures / 15 min per username → 429
- `GET /v1/me` → `{player, active, features}`; `active` = this token is the one device allowed to play and save
- `PUT /v1/save {sram (base64 ≤ 200 KB), minds (JSON ≤ 2 MB), rom?, note?}` → `{version, at, same_sram}` — active device only (409 otherwise); every version kept in `saves`
- `GET /v1/save` → latest `{version, at, rom, sram, minds}` or `{version: 0}`
- `POST /v1/events {events:[{kind, at?, data?}]}` — ≤200/request, kind `[a-z0-9_.:-]{1,48}`, data ≤4 KB JSON
- `POST /v1/llm` — Anthropic Messages passthrough; model allowlist (`LLM_MODELS` = `claude-sonnet-5-5`), `max_tokens` cap, per-player rolling-24 h token budget (`LLM_DAILY_TOKENS`); every call stored in `llm_calls` (full request/response + hash) for replay
- `POST /v1/ai/chat/completions` — Pokémon models. OpenAI-compatible, so the browser's pi-ai uses it as a provider (`baseUrl` = `<api>/v1/ai`, API key = session token). Workers AI via the Worker's AI binding through AI Gateway `default` → no Cloudflare token on the Worker. Allowlist `AI_MODELS` (Llama 3.2 3B, Granite 4.0 H Micro), `AI_MAX_TOKENS` 600, `AI_DAILY_TOKENS` 400k/player/24 h; streamed through; recorded in `llm_calls`. Deploy smoke test calls it as a throwaway `ci-smoke` player
- `GET /admin` — page; `/admin/api/{players,events,llm,invites,invites/revoke}` with `Bearer ADMIN_TOKEN`

## Decisions
- no framework, one file (`src/index.ts`) + static admin page
- CORS: maxcembalest.com, www, `*.vercel.app`, localhost
- invite codes `RED-XXXX-XXXX` (no I/L/O/0/1), case/space-insensitive, `max_uses`, revocable
- accounts (2026-10-08, migration 0002): username + password on `players`; one active device (`active_session` = token hash of the last login); the in-game save is the only commit point: a save = SRAM + the party's minds, every version kept. No password reset yet (admin can't either) — ask the owner
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
- test: `player/tests/account.py` (Chromium + mock backend; runs in CI): join, snapshot beacon, reload, takeover + login
- accounts + cloud saves (2026-10-08): join form has username/password, login form for another device; `player/src/cloud.ts`
  - start: `GET /v1/save`; restore the cloud copy when there is no local save or the cloud version > the last version this device synced (`code-red-cloud-version` in localStorage); otherwise the local copy (IDBFS, then the IndexedDB backup)
  - play: `autosave` fingerprints SRAM every 10 s; a change (an in-game save) → `PUT /v1/save` with SRAM + `minds.export()` (readers, hot memory, Pokédex); coalesced
  - takeover: `/v1/me` polled every 30 s; `active: false` or a 409 on upload → game paused, "Play here instead" → login form → active again, newer cloud save restored
  - no backend (`api=false`) → local only, as before

## Next
- custom domain `api.maxcembalest.com` (needs the domain's DNS on Cloudflare)
