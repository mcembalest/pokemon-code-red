// Code Red backend (Cloudflare Worker + D1).
//
//   GET  /health                      liveness + version
//   POST /v1/join      {invite,name}  → {player, token}       (invite-gated sign-up)
//   GET  /v1/me                       → {player}               (Bearer token)
//   POST /v1/events    {events:[…]}   → {stored}               (progress tracking)
//   POST /v1/llm       {messages,…}   → Anthropic response     (interim agent backend; recorded)
//   GET  /admin                       admin page (asks for ADMIN_TOKEN)
//   /admin/api/*                      JSON for the admin page (Bearer ADMIN_TOKEN)
import { adminPage } from './admin';
import { MAP_NAMES } from './maps';

export interface Env {
  DB: D1Database;
  ANTHROPIC_API_KEY?: string;
  ADMIN_TOKEN?: string;
  ANTHROPIC_BASE_URL?: string;
  ALLOWED_ORIGINS: string;   // comma list; entries may be 'https://*.example.com'
  LLM_MODELS: string;        // comma list; first = default
  LLM_DAILY_TOKENS: string;  // per player, rolling 24 h
  LLM_MAX_TOKENS: string;    // cap per call
  VERSION?: string;
}

type Player = { id: string; name: string; created_at: number; last_seen: number };

const DAY = 24 * 60 * 60 * 1000;
const MAX_EVENTS = 200;
const MAX_EVENT_DATA = 4096;
const MAX_LLM_BODY = 64 * 1024;
const KIND = /^[a-z0-9_.:-]{1,48}$/;

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    let res: Response;
    try {
      res = await route(req, env);
    } catch (e) {
      if (e instanceof HttpError) res = json({ error: e.message }, e.status);
      else { console.error(e); res = json({ error: 'internal error' }, 500); }
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },
};

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const m = req.method;

  if (p === '/health' && m === 'GET') return json({ ok: true, version: env.VERSION || 'dev', llm: !!env.ANTHROPIC_API_KEY, admin: !!env.ADMIN_TOKEN });
  if (p === '/v1/join' && m === 'POST') return join(req, env);
  if (p === '/v1/me' && m === 'GET') return json({ player: await auth(req, env) });
  if (p === '/v1/events' && m === 'POST') return events(req, env);
  if (p === '/v1/llm' && m === 'POST') return llm(req, env, await auth(req, env));

  if (p === '/admin' && m === 'GET') return new Response(adminPage, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  if (p.startsWith('/admin/api/')) {
    await adminAuth(req, env);
    const sub = p.slice('/admin/api/'.length);
    if (sub === 'players' && m === 'GET') return adminPlayers(env);
    if (sub === 'events' && m === 'GET') return adminEvents(env, url);
    if (sub === 'llm' && m === 'GET') return adminLlm(env, url);
    if (sub === 'agent-records' && m === 'GET') return adminAgentRecords(env, url);
    if (sub === 'invites' && m === 'GET') return json({ invites: (await env.DB.prepare('SELECT * FROM invites ORDER BY created_at DESC').all()).results });
    if (sub === 'invites' && m === 'POST') return adminCreateInvites(req, env);
    if (sub === 'invites/revoke' && m === 'POST') {
      const { code } = await body<{ code: string }>(req);
      await env.DB.prepare('UPDATE invites SET revoked = 1 WHERE code = ?').bind(normCode(code)).run();
      return json({ ok: true });
    }
  }
  throw new HttpError(404, 'not found');
}

// ---------------------------------------------------------------- players

async function join(req: Request, env: Env): Promise<Response> {
  const { invite, name } = await body<{ invite?: string; name?: string }>(req);
  const code = normCode(invite || '');
  const display = (name || '').trim().replace(/\s+/g, ' ');
  if (!code) throw new HttpError(400, 'invite required');
  if (display.length < 1 || display.length > 24) throw new HttpError(400, 'name must be 1-24 characters');

  const now = Date.now();
  const claimed = await env.DB.prepare('UPDATE invites SET uses = uses + 1 WHERE code = ? AND revoked = 0 AND uses < max_uses').bind(code).run();
  if (!claimed.meta.changes) throw new HttpError(403, 'invite not valid');

  const id = crypto.randomUUID();
  const token = randomToken();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO players (id, name, invite, created_at, last_seen) VALUES (?, ?, ?, ?, ?)').bind(id, display, code, now, now),
    env.DB.prepare('INSERT INTO sessions (token_hash, player_id, created_at, user_agent) VALUES (?, ?, ?, ?)').bind(await sha256(token), id, now, (req.headers.get('user-agent') || '').slice(0, 200)),
    env.DB.prepare('INSERT INTO events (player_id, at, received_at, kind, data) VALUES (?, ?, ?, ?, ?)').bind(id, now, now, 'joined', JSON.stringify({ invite: code })),
  ]);
  return json({ player: { id, name: display, created_at: now, last_seen: now }, token }, 201);
}

async function auth(req: Request, env: Env, fallbackToken?: unknown): Promise<Player> {
  // sendBeacon can't set headers, so /v1/events also accepts the token in the body.
  const token = bearer(req) || (typeof fallbackToken === 'string' ? fallbackToken : null);
  if (!token) throw new HttpError(401, 'missing token');
  const row = await env.DB.prepare(
    'SELECT p.id, p.name, p.created_at, p.last_seen FROM sessions s JOIN players p ON p.id = s.player_id WHERE s.token_hash = ?',
  ).bind(await sha256(token)).first<Player>();
  if (!row) throw new HttpError(401, 'invalid token');
  const now = Date.now();
  if (now - row.last_seen > 60_000) await env.DB.prepare('UPDATE players SET last_seen = ? WHERE id = ?').bind(now, row.id).run();
  return row;
}

async function events(req: Request, env: Env): Promise<Response> {
  const { events: list, token } = await body<{ events?: { kind?: string; at?: number; data?: unknown }[]; token?: string }>(req);
  const player = await auth(req, env, token);
  if (!Array.isArray(list) || list.length === 0) throw new HttpError(400, 'events must be a non-empty array');
  if (list.length > MAX_EVENTS) throw new HttpError(413, `at most ${MAX_EVENTS} events per request`);
  const now = Date.now();
  const stmts = list.map((e) => {
    if (!e || typeof e.kind !== 'string' || !KIND.test(e.kind)) throw new HttpError(400, 'bad event kind');
    const data = e.data === undefined ? null : JSON.stringify(e.data);
    if (data && data.length > MAX_EVENT_DATA) throw new HttpError(413, 'event data too large');
    const at = typeof e.at === 'number' && Number.isFinite(e.at) ? Math.round(e.at) : now;
    return env.DB.prepare('INSERT INTO events (player_id, at, received_at, kind, data) VALUES (?, ?, ?, ?, ?)').bind(player.id, at, now, e.kind, data);
  });
  await env.DB.batch(stmts);
  return json({ stored: stmts.length });
}

// ---------------------------------------------------------------- LLM (interim)

async function llm(req: Request, env: Env, player: Player): Promise<Response> {
  if (!env.ANTHROPIC_API_KEY) throw new HttpError(503, 'agent backend not configured');
  const raw = await req.text();
  if (raw.length > MAX_LLM_BODY) throw new HttpError(413, 'request too large');
  let input: Record<string, unknown>;
  try { input = JSON.parse(raw); } catch { throw new HttpError(400, 'invalid JSON'); }

  const models = env.LLM_MODELS.split(',').map((s) => s.trim()).filter(Boolean);
  const model = (input.model as string) || models[0];
  if (!models.includes(model)) throw new HttpError(400, `model must be one of: ${models.join(', ')}`);
  if (!Array.isArray(input.messages) || input.messages.length === 0) throw new HttpError(400, 'messages required');
  const cap = Number(env.LLM_MAX_TOKENS) || 1024;
  const maxTokens = Math.min(Number(input.max_tokens) || cap, cap);

  const since = Date.now() - DAY;
  const used = await env.DB.prepare('SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS n FROM llm_calls WHERE player_id = ? AND at > ?')
    .bind(player.id, since).first<{ n: number }>();
  const budget = Number(env.LLM_DAILY_TOKENS) || 200_000;
  if ((used?.n || 0) >= budget) throw new HttpError(429, 'daily agent budget used up');

  // Only pass through the fields an agent turn needs.
  const upstream: Record<string, unknown> = { model, max_tokens: maxTokens, messages: input.messages };
  for (const k of ['system', 'tools', 'tool_choice', 'temperature', 'stop_sequences']) if (input[k] !== undefined) upstream[k] = input[k];
  const reqText = JSON.stringify(upstream);

  const t0 = Date.now();
  const r = await fetch(`${env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: reqText,
  });
  const resText = await r.text();
  let usage = { input_tokens: 0, output_tokens: 0 };
  try { usage = { ...usage, ...(JSON.parse(resText).usage || {}) }; } catch { /* non-JSON error body */ }
  await env.DB.prepare(
    'INSERT INTO llm_calls (player_id, at, model, request_hash, request, response, status, input_tokens, output_tokens, ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(player.id, t0, model, await sha256(reqText), reqText, resText.slice(0, 200_000), r.status, usage.input_tokens | 0, usage.output_tokens | 0, Date.now() - t0).run();

  return new Response(resText, { status: r.ok ? 200 : 502, headers: { 'content-type': 'application/json' } });
}

// ---------------------------------------------------------------- admin

async function adminAuth(req: Request, env: Env): Promise<void> {
  if (!env.ADMIN_TOKEN) throw new HttpError(503, 'ADMIN_TOKEN not set on the worker');
  const given = bearer(req) || '';
  // Compare hashes so the comparison time doesn't depend on the secret.
  if ((await sha256(given)) !== (await sha256(env.ADMIN_TOKEN))) throw new HttpError(401, 'bad admin token');
}

async function adminPlayers(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(`
    SELECT p.id, p.name, p.invite, p.created_at, p.last_seen,
      (SELECT COUNT(*) FROM events e WHERE e.player_id = p.id) AS events,
      (SELECT MAX(json_extract(e.data, '$.badge_count')) FROM events e WHERE e.player_id = p.id AND e.kind = 'snapshot') AS badges,
      (SELECT MAX(json_extract(e.data, '$.play_s')) FROM events e WHERE e.player_id = p.id AND e.kind IN ('snapshot', 'map', 'badge')) AS play_s,
      (SELECT json_extract(e.data, '$.party') FROM events e WHERE e.player_id = p.id AND e.kind = 'snapshot' ORDER BY e.at DESC, e.id DESC LIMIT 1) AS party,
      (SELECT json_extract(e.data, '$.map') FROM events e WHERE e.player_id = p.id AND e.kind IN ('snapshot', 'map') ORDER BY e.at DESC, e.id DESC LIMIT 1) AS map,
      (SELECT e.kind FROM events e WHERE e.player_id = p.id ORDER BY e.at DESC, e.id DESC LIMIT 1) AS last_event,
      (SELECT COUNT(*) FROM llm_calls l WHERE l.player_id = p.id) AS llm_calls,
      (SELECT COALESCE(SUM(l.input_tokens + l.output_tokens), 0) FROM llm_calls l WHERE l.player_id = p.id) AS llm_tokens
    FROM players p ORDER BY p.last_seen DESC`).all<Record<string, unknown>>();
  return json({ players: rows.results.map((r) => ({ ...r, place: mapName(r.map) })) });
}

async function adminEvents(env: Env, url: URL): Promise<Response> {
  const player = url.searchParams.get('player');
  const limit = Math.min(Number(url.searchParams.get('limit')) || 200, 1000);
  const q = player
    ? env.DB.prepare('SELECT e.*, p.name FROM events e JOIN players p ON p.id = e.player_id WHERE e.player_id = ? ORDER BY e.at DESC LIMIT ?').bind(player, limit)
    : env.DB.prepare('SELECT e.*, p.name FROM events e JOIN players p ON p.id = e.player_id ORDER BY e.at DESC LIMIT ?').bind(limit);
  const rows = (await q.all<Record<string, unknown> & { data: string | null }>()).results;
  return json({ events: rows.map((r) => {
    let place: string | null = null;
    try { place = mapName(JSON.parse(r.data || 'null')?.map); } catch { /* not JSON */ }
    return { ...r, place };
  }) });
}

/** [group, num] (or its JSON text) → readable name. */
export function mapName(map: unknown): string | null {
  const m = typeof map === 'string' ? (() => { try { return JSON.parse(map); } catch { return null; } })() : map;
  if (!Array.isArray(m) || m.length !== 2) return null;
  return MAP_NAMES[`${m[0]}.${m[1]}`] ?? `map ${m[0]}.${m[1]}`;
}

/** A player's agent decisions in the player's replay format (agents/agent.ts DecisionRecord). */
async function adminAgentRecords(env: Env, url: URL): Promise<Response> {
  const player = url.searchParams.get('player');
  if (!player) throw new HttpError(400, 'player required');
  const rows = await env.DB.prepare("SELECT at, data FROM events WHERE player_id = ? AND kind = 'agent_decision' ORDER BY at, id").bind(player).all<{ at: number; data: string }>();
  const records = rows.results.flatMap((r) => {
    try {
      const d = JSON.parse(r.data);
      if (!d.key || !d.action) return [];
      return [{ agent: 'lead', key: d.key, observation: d.observation ?? '', decision: { action: d.action, args: d.args ?? {}, thought: d.thought ?? '' }, brain: d.brain, ms: d.ms ?? 0, at: r.at, ...(d.fallback ? { fallback: d.fallback } : {}) }];
    } catch { return []; }
  });
  return json(records);
}

async function adminLlm(env: Env, url: URL): Promise<Response> {
  const player = url.searchParams.get('player');
  const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 500);
  const cols = 'id, player_id, at, model, request_hash, status, input_tokens, output_tokens, ms';
  const q = player
    ? env.DB.prepare(`SELECT ${cols} FROM llm_calls WHERE player_id = ? ORDER BY at DESC LIMIT ?`).bind(player, limit)
    : env.DB.prepare(`SELECT ${cols} FROM llm_calls ORDER BY at DESC LIMIT ?`).bind(limit);
  return json({ calls: (await q.all()).results });
}

async function adminCreateInvites(req: Request, env: Env): Promise<Response> {
  const { count = 1, max_uses = 1, note = null } = await body<{ count?: number; max_uses?: number; note?: string | null }>(req);
  const n = Math.max(1, Math.min(50, Math.floor(count)));
  const uses = Math.max(1, Math.min(1000, Math.floor(max_uses)));
  const now = Date.now();
  const codes = Array.from({ length: n }, inviteCode);
  await env.DB.batch(codes.map((c) => env.DB.prepare('INSERT INTO invites (code, note, max_uses, created_at) VALUES (?, ?, ?, ?)').bind(c, note, uses, now)));
  return json({ codes }, 201);
}

// ---------------------------------------------------------------- helpers

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

async function body<T>(req: Request): Promise<T> {
  try { return (await req.json()) as T; } catch { throw new HttpError(400, 'invalid JSON'); }
}

function bearer(req: Request): string | null {
  const h = req.headers.get('authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I, L, O, 0, 1
export function inviteCode(): string {
  const b = crypto.getRandomValues(new Uint8Array(8));
  const s = [...b].map((x) => ALPHABET[x % ALPHABET.length]).join('');
  return `RED-${s.slice(0, 4)}-${s.slice(4)}`;
}

export function normCode(s: string): string {
  return s.trim().toUpperCase().replace(/\s+/g, '');
}

export function originAllowed(origin: string, allowed: string): boolean {
  return allowed.split(',').map((s) => s.trim()).filter(Boolean).some((a) => {
    if (a === origin) return true;
    const star = a.indexOf('*.');
    if (star < 0) return false;
    const [scheme, suffix] = [a.slice(0, star), a.slice(star + 1)]; // 'https://', '.vercel.app'
    return origin.startsWith(scheme) && origin.endsWith(suffix) && !origin.slice(scheme.length, -suffix.length).includes('/');
  });
}

function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('origin');
  if (!origin || !originAllowed(origin, env.ALLOWED_ORIGINS)) return { vary: 'Origin' };
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}
