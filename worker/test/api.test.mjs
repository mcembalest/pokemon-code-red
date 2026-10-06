// End-to-end test of the Worker under `wrangler dev` (local workerd + local D1),
// with a mock Anthropic API. Run: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ADMIN = 'test-admin-token';
const persist = mkdtempSync(join(tmpdir(), 'cr-worker-'));
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' };
let base, wrangler, mock, mockCalls = [];

async function freePort() {
  const s = createServer(); await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address(); await new Promise((r) => s.close(r)); return port;
}

before(async () => {
  mock = createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      mockCalls.push({ headers: req.headers, body: JSON.parse(b) });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id: 'msg_1', type: 'message', content: [{ type: 'tool_use', name: 'scan', input: {} }], usage: { input_tokens: 120, output_tokens: 30 } }));
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  execFileSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'code-red', '--local', '--persist-to', persist], { env, stdio: 'pipe' });
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  wrangler = spawn('npx', ['wrangler', 'dev', '--local', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', persist,
    '--var', `ANTHROPIC_BASE_URL:http://127.0.0.1:${mock.address().port}`, '--var', 'ANTHROPIC_API_KEY:sk-test', '--var', `ADMIN_TOKEN:${ADMIN}`,
    '--var', 'LLM_DAILY_TOKENS:300', '--var', 'VERSION:test'], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let log = ''; wrangler.stdout.on('data', (d) => (log += d)); wrangler.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(base + '/health')).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('wrangler dev did not start:\n' + log);
});

after(() => {
  try { process.kill(-wrangler.pid, 'SIGTERM'); } catch {}
  mock?.close();
  rmSync(persist, { recursive: true, force: true });
});

const call = (path, { token, body, method, origin } = {}) => fetch(base + path, {
  method: method || (body ? 'POST' : 'GET'),
  headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...(origin ? { origin } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});

test('health', async () => {
  const j = await (await call('/health')).json();
  assert.deepEqual(j, { ok: true, version: 'test', llm: true, admin: true });
});

test('admin requires token', async () => {
  assert.equal((await call('/admin/api/players')).status, 401);
  assert.equal((await call('/admin/api/players', { token: 'nope' })).status, 401);
  assert.equal((await call('/admin')).status, 200); // page itself is static
});

let token, playerId;

test('invite → join → me; invites are single-use', async () => {
  const r = await call('/admin/api/invites', { token: ADMIN, body: { count: 2, max_uses: 1, note: 'test' } });
  assert.equal(r.status, 201);
  const { codes } = await r.json();
  assert.equal(codes.length, 2);
  assert.match(codes[0], /^RED-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

  assert.equal((await call('/v1/join', { body: { invite: 'RED-NOPE-NOPE', name: 'Ash' } })).status, 403);
  assert.equal((await call('/v1/join', { body: { invite: codes[0], name: '' } })).status, 400);

  const j = await call('/v1/join', { body: { invite: ' ' + codes[0].toLowerCase() + ' ', name: '  Ash  K ' } });
  assert.equal(j.status, 201);
  const joined = await j.json();
  assert.equal(joined.player.name, 'Ash K');
  token = joined.token; playerId = joined.player.id;

  assert.equal((await call('/v1/join', { body: { invite: codes[0], name: 'Gary' } })).status, 403); // used up
  const me = await (await call('/v1/me', { token })).json();
  assert.equal(me.player.id, playerId);
  assert.equal((await call('/v1/me', { token: 'bogus' })).status, 401);
  assert.equal((await call('/v1/me')).status, 401);

  await call('/admin/api/invites/revoke', { token: ADMIN, body: { code: codes[1] } });
  assert.equal((await call('/v1/join', { body: { invite: codes[1], name: 'Gary' } })).status, 403); // revoked
});

test('events: stored, validated, visible to admin', async () => {
  const ok = await call('/v1/events', { token, body: { events: [
    { kind: 'snapshot', at: 1000, data: { play_s: 3600, map: [3, 0], badges: 1, badge_count: 1, party: [12, 7] } },
    { kind: 'map', at: 1234, data: { map: [3, 19], play_s: 3700 } }] } });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { stored: 2 });
  // sendBeacon path: no auth header, token in the body, text/plain
  const beacon = await fetch(base + '/v1/events', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ token, events: [{ kind: 'badge', at: 1300, data: { n: 2 } }] }) });
  assert.equal(beacon.status, 200);
  assert.equal((await fetch(base + '/v1/events', { method: 'POST', body: JSON.stringify({ token: 'bogus', events: [{ kind: 'x' }] }) })).status, 401);
  assert.equal((await call('/v1/events', { token, body: { events: [{ kind: 'Bad Kind' }] } })).status, 400);
  assert.equal((await call('/v1/events', { token, body: { events: [] } })).status, 400);
  assert.equal((await call('/v1/events', { token, body: { events: [{ kind: 'x', data: 'a'.repeat(5000) }] } })).status, 413);
  assert.equal((await call('/v1/events', { body: { events: [{ kind: 'x' }] } })).status, 401);

  const { players } = await (await call('/admin/api/players', { token: ADMIN })).json();
  const p = players.find((x) => x.id === playerId);
  assert.equal(p.badges, 1);
  assert.equal(p.play_s, 3700);
  assert.equal(p.place, 'Route 1');
  assert.deepEqual(JSON.parse(p.party), [12, 7]);
  assert.equal(p.events, 4); // joined + 3
  const { events } = await (await call(`/admin/api/events?player=${playerId}`, { token: ADMIN })).json();
  assert.deepEqual(events.map((e) => e.kind).sort(), ['badge', 'joined', 'map', 'snapshot']);
  assert.equal(events.find((e) => e.kind === 'snapshot').place, 'Pallet Town');
});

test('llm proxy: forwards, records, enforces model + budget', async () => {
  assert.equal((await call('/v1/llm', { token, body: { model: 'gpt-x', messages: [{ role: 'user', content: 'hi' }] } })).status, 400);
  assert.equal((await call('/v1/llm', { token, body: { messages: [] } })).status, 400);

  const r = await call('/v1/llm', { token, body: { messages: [{ role: 'user', content: 'pick an action' }], max_tokens: 99999, tools: [{ name: 'scan', input_schema: { type: 'object' } }], evil: true } });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).content[0].name, 'scan');
  const sent = mockCalls.at(-1);
  assert.equal(sent.headers['x-api-key'], 'sk-test');
  assert.equal(sent.body.model, 'claude-sonnet-5-5');
  assert.equal(sent.body.max_tokens, 1024);
  assert.equal(sent.body.evil, undefined);

  const { calls } = await (await call('/admin/api/llm', { token: ADMIN })).json();
  assert.equal(calls[0].input_tokens, 120);
  assert.equal(calls[0].output_tokens, 30);

  // 150 tokens used, budget 300 → one more allowed, then 429
  assert.equal((await call('/v1/llm', { token, body: { messages: [{ role: 'user', content: 'again' }] } })).status, 200);
  assert.equal((await call('/v1/llm', { token, body: { messages: [{ role: 'user', content: 'again' }] } })).status, 429);
});

test('cors: allowed origins only', async () => {
  const ok = await call('/health', { origin: 'https://maxcembalest.com' });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://maxcembalest.com');
  const preview = await call('/health', { origin: 'https://site-git-x-max.vercel.app' });
  assert.equal(preview.headers.get('access-control-allow-origin'), 'https://site-git-x-max.vercel.app');
  const bad = await call('/health', { origin: 'https://evil.example' });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
  const pre = await call('/v1/events', { method: 'OPTIONS', origin: 'https://maxcembalest.com' });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-headers'), /authorization/);
});
