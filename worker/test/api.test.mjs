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
      mockCalls.push({ url: req.url, headers: req.headers, body: JSON.parse(b) });
      if (req.url === '/ai/chat/completions') {
        const body = JSON.parse(b);
        if (body.stream) {
          res.setHeader('content-type', 'text/event-stream');
          res.write('data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"```js\\nawait tools.scratch({slot:1})"}}]}\n\n');
          res.write('data: {"choices":[{"index":0,"delta":{"content":"\\n```"},"finish_reason":"stop"}]}\n\n');
          res.write('data: {"choices":[],"usage":{"prompt_tokens":200,"completion_tokens":20,"total_tokens":220}}\n\n');
          res.end('data: [DONE]\n\n');
        } else {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ id: 'c1', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: 'return 1' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 10 } }));
        }
        return;
      }
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
    '--var', 'LLM_DAILY_TOKENS:300', '--var', 'VERSION:test',
    '--var', `AI_UPSTREAM_URL:http://127.0.0.1:${mock.address().port}/ai`, '--var', 'AI_DAILY_TOKENS:400', '--var', 'AI_MAX_TOKENS:600'], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
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
  assert.deepEqual(j, { ok: true, version: 'test', llm: true, ai: true, admin: true });
});

test('admin requires token', async () => {
  assert.equal((await call('/admin/api/players')).status, 401);
  assert.equal((await call('/admin/api/players', { token: 'nope' })).status, 401);
  assert.equal((await call('/admin')).status, 200); // page itself is static
});

let token, playerId, recovery;

test('invite → join → me; invites are single-use', async () => {
  const r = await call('/admin/api/invites', { token: ADMIN, body: { count: 2, max_uses: 1, note: 'test' } });
  assert.equal(r.status, 201);
  const { codes } = await r.json();
  assert.equal(codes.length, 2);
  assert.match(codes[0], /^RED-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

  const acct = { username: 'Ash_K', password: 'pikachu-123' };
  assert.equal((await call('/v1/join', { body: { invite: 'RED-NOPE-NOPE', name: 'Ash', ...acct } })).status, 403);
  assert.equal((await call('/v1/join', { body: { invite: codes[0], name: '', ...acct } })).status, 400);
  assert.equal((await call('/v1/join', { body: { invite: codes[0], name: 'Ash', username: 'a b', password: acct.password } })).status, 400);
  assert.equal((await call('/v1/join', { body: { invite: codes[0], name: 'Ash', username: 'ash', password: 'short' } })).status, 400);
  assert.equal((await call('/v1/join', { body: { invite: codes[0], name: 'Ash' } })).status, 400); // no account

  const j = await call('/v1/join', { body: { invite: ' ' + codes[0].toLowerCase() + ' ', name: '  Ash  K ', ...acct } });
  assert.equal(j.status, 201);
  const joined = await j.json();
  assert.deepEqual(joined.features, { agents: true });
  assert.equal(joined.player.name, 'Ash K');
  assert.equal(joined.player.username, 'ash_k'); // lowercased
  assert.equal(joined.active, true);
  assert.match(joined.recovery, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/); // shown once
  recovery = joined.recovery;
  token = joined.token; playerId = joined.player.id;

  assert.equal((await call('/v1/join', { body: { invite: codes[0], name: 'Gary', username: 'gary', password: 'eevee-12345' } })).status, 403); // used up
  assert.equal((await call('/v1/join', { body: { invite: codes[1], name: 'Gary', username: 'ASH_K', password: 'eevee-12345' } })).status, 409); // name taken (before the invite is spent)
  const me = await (await call('/v1/me', { token })).json();
  assert.deepEqual(me.features, { agents: true });
  assert.equal(me.player.id, playerId);
  assert.equal(me.player.username, 'ash_k');
  assert.equal(me.player.password_hash, undefined);
  assert.equal(me.active, true);
  assert.equal((await call('/v1/me', { token: 'bogus' })).status, 401);
  assert.equal((await call('/v1/me')).status, 401);

  await call('/admin/api/invites/revoke', { token: ADMIN, body: { code: codes[1] } });
  assert.equal((await call('/v1/join', { body: { invite: codes[1], name: 'Gary', username: 'gary', password: 'eevee-12345' } })).status, 403); // revoked
});

let oldToken; // the first device, after a second one logs in

test('forgot password: the recovery code sets a new password, signs every session out, and rotates', async () => {
  assert.equal((await call('/v1/recover', { body: { username: 'ash_k', recovery: 'XXXX-XXXX-XXXX', password: 'new-password-1' } })).status, 401);
  assert.equal((await call('/v1/recover', { body: { username: 'ash_k', recovery, password: 'short' } })).status, 400);
  const r = await call('/v1/recover', { body: { username: 'ASH_K', recovery: recovery.toLowerCase(), password: 'new-password-1' } });
  assert.equal(r.status, 200);
  const got = await r.json();
  assert.equal(got.player.id, playerId); assert.equal(got.active, true);
  assert.match(got.recovery, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/); assert.notEqual(got.recovery, recovery);
  assert.equal((await call('/v1/me', { token })).status, 401); // the old session is gone
  assert.equal((await call('/v1/login', { body: { username: 'ash_k', password: 'pikachu-123' } })).status, 401); // old password gone
  assert.equal((await call('/v1/recover', { body: { username: 'ash_k', recovery, password: 'again-again-1' } })).status, 401); // single use
  token = got.token; recovery = got.recovery;
  assert.equal((await (await call('/v1/me', { token })).json()).active, true);

  // change password while signed in: needs the current one; the other session is signed out, this one stays
  const other = await (await call('/v1/login', { body: { username: 'ash_k', password: 'new-password-1' } })).json();
  assert.equal((await call('/v1/password', { token, body: { current: 'wrong-password', password: 'pikachu-123' } })).status, 401);
  assert.equal((await call('/v1/password', { token, body: { current: 'new-password-1', password: 'pikachu-123' } })).status, 200);
  assert.equal((await call('/v1/me', { token: other.token })).status, 401);
  const me = await (await call('/v1/me', { token })).json();
  assert.equal(me.active, true); // and this device is the active one again

  // admin fallback: a fresh code for a player who lost everything
  const a = await call('/admin/api/players/recovery', { token: ADMIN, body: { id: playerId } });
  assert.equal(a.status, 200);
  const fresh = (await a.json()).recovery;
  assert.notEqual(fresh, recovery);
  assert.equal((await call('/v1/recover', { body: { username: 'ash_k', recovery, password: 'whatever-123' } })).status, 401);
  recovery = fresh;
  // and a signed-in player can get a fresh code with their password (accounts from before codes existed)
  assert.equal((await call('/v1/recovery', { token, body: { current: 'nope-nope-nope' } })).status, 401);
  const mine = await (await call('/v1/recovery', { token, body: { current: 'pikachu-123' } })).json();
  assert.match(mine.recovery, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal((await (await call('/v1/me', { token })).json()).has_recovery, true);
  recovery = mine.recovery;
  // the next test logs in with pikachu-123 and takes over
});

test('login takes over as the active device; saves are versioned and active-only', async () => {
  assert.equal((await call('/v1/login', { body: { username: 'ash_k', password: 'wrong-password' } })).status, 401);
  assert.equal((await call('/v1/login', { body: { username: 'nobody', password: 'pikachu-123' } })).status, 401);
  assert.equal((await call('/v1/login', { body: { username: 'a b' } })).status, 400);

  // no save yet
  assert.deepEqual(await (await call('/v1/save', { token })).json(), { version: 0 });

  const sram1 = Buffer.alloc(64, 1).toString('base64');
  assert.equal((await call('/v1/save', { token, method: 'PUT', body: { sram: 'not base64!' } })).status, 400);
  assert.equal((await call('/v1/save', { method: 'PUT', body: { sram: sram1 } })).status, 401);
  const s1 = await call('/v1/save', { token, method: 'PUT', body: { sram: sram1, minds: { readers: { 42: ['ROCK'] }, hot: { 42: 'be brave' } }, rom: 'abc123', note: 'Pallet' } });
  assert.equal(s1.status, 200);
  const v1 = await s1.json();
  assert.equal(v1.version, 1);
  assert.equal(v1.same_sram, false);
  const again = await (await call('/v1/save', { token, method: 'PUT', body: { sram: sram1, minds: {} } })).json();
  assert.deepEqual([again.version, again.same_sram], [2, true]);

  // second device logs in (case-insensitive username) → takes over
  const l = await call('/v1/login', { body: { username: ' ASH_K ', password: 'pikachu-123' } });
  assert.equal(l.status, 200);
  const logged = await l.json();
  assert.equal(logged.player.id, playerId);
  assert.equal(logged.active, true);
  assert.notEqual(logged.token, token);
  oldToken = token; token = logged.token;

  // the old device still authenticates but is no longer active: it can read, not save
  const oldMe = await (await call('/v1/me', { token: oldToken })).json();
  assert.equal(oldMe.active, false);
  assert.equal((await call('/v1/save', { token: oldToken, method: 'PUT', body: { sram: sram1 } })).status, 409);
  assert.equal((await call('/v1/save', { token: oldToken })).status, 200);

  // the new device saves version 3; GET returns the latest with minds parsed
  const sram2 = Buffer.alloc(64, 2).toString('base64');
  const v3 = await (await call('/v1/save', { token, method: 'PUT', body: { sram: sram2, minds: { hot: { 42: 'cerulean' } }, rom: 'abc123' } })).json();
  assert.deepEqual([v3.version, v3.same_sram], [3, false]);
  const latest = await (await call('/v1/save', { token })).json();
  assert.equal(latest.version, 3);
  assert.equal(latest.sram, sram2);
  assert.equal(latest.rom, 'abc123');
  assert.deepEqual(latest.minds, { hot: { 42: 'cerulean' } });
  assert.equal(typeof latest.at, 'number');

  // login attempts are rate limited: 10 failures in 15 minutes
  for (let i = 0; i < 9; i++) await call('/v1/login', { body: { username: 'ash_k', password: 'nope-nope-nope' } });
  assert.equal((await call('/v1/login', { body: { username: 'ash_k', password: 'pikachu-123' } })).status, 429);
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
  assert.ok(p.events >= 5, String(p.events)); // joined, logins, recovered, password_changed, recovery_reset + 3
  const { events } = await (await call(`/admin/api/events?player=${playerId}`, { token: ADMIN })).json();
  for (const k of ['badge', 'joined', 'login', 'map', 'snapshot', 'recovered', 'password_changed', 'recovery_reset']) assert.ok(events.some((e) => e.kind === k), k);
  assert.equal(events.find((e) => e.kind === 'snapshot').place, 'Pallet Town');
});

test('agent records export (replay format)', async () => {
  await call('/v1/events', { token, body: { events: [
    { kind: 'agent_decision', at: 5000, data: { brain: 'cloud', key: 'abc12345', observation: 'Foe: SQUIRTLE', action: 'scratch', args: {}, thought: 'Go!', ms: 900 } },
    { kind: 'agent_decision', at: 5001, data: { brain: 'cloud', action: 'old_format_without_key' } }] } });
  const r = await (await call(`/admin/api/agent-records?player=${playerId}`, { token: ADMIN })).json();
  assert.deepEqual(r, [{ agent: 'lead', key: 'abc12345', observation: 'Foe: SQUIRTLE', decision: { action: 'scratch', args: {}, thought: 'Go!' }, brain: 'cloud', ms: 900, at: 5000 }]);
  assert.equal((await call('/admin/api/agent-records', { token: ADMIN })).status, 400);
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

test('workers AI route: OpenAI-compatible, allowlisted, capped, streamed, recorded, budgeted', async () => {
  const M = '@cf/meta/llama-3.2-3b-instruct';
  const msgs = [{ role: 'system', content: 'You are CHARMANDER.' }, { role: 'user', content: 'use SCRATCH!' }];
  assert.equal((await call('/v1/ai/chat/completions', { body: { model: M, messages: msgs } })).status, 401);
  assert.equal((await call('/v1/ai/chat/completions', { token, body: { model: '@cf/qwen/qwen2.5-coder-32b-instruct', messages: msgs } })).status, 400);
  assert.equal((await call('/v1/ai/chat/completions', { token, body: { model: M, messages: [] } })).status, 400);

  const plain = await call('/v1/ai/chat/completions', { token, body: { model: M, messages: msgs, max_tokens: 99999, evil: 1, temperature: 0.8 } });
  assert.equal(plain.status, 200);
  assert.equal((await plain.json()).choices[0].message.content, 'return 1');
  const sent = mockCalls.at(-1);
  assert.equal(sent.url, '/ai/chat/completions');
  assert.equal(sent.body.max_tokens, 600);
  assert.equal(sent.body.evil, undefined);
  assert.equal(sent.body.temperature, 0.8);

  const streamed = await call('/v1/ai/chat/completions', { token, body: { model: M, messages: msgs, stream: true, tools: [{ type: 'function', function: { name: 'code', parameters: { type: 'object' } } }] } });
  assert.equal(streamed.status, 200);
  assert.match(streamed.headers.get('content-type'), /event-stream/);
  const text = await streamed.text();
  assert.match(text, /tools\.scratch/);
  assert.match(text, /\[DONE\]/);
  assert.deepEqual(mockCalls.at(-1).body.stream_options, { include_usage: true });
  assert.equal(mockCalls.at(-1).body.tools[0].function.name, 'code');

  // recorded (110 + 220 tokens); budget 400 → one more allowed, then 429
  let calls = [];
  for (let i = 0; i < 20 && calls.filter((c) => c.model === M).length < 2; i++) {
    calls = (await (await call('/admin/api/llm', { token: ADMIN })).json()).calls;
    await new Promise((r) => setTimeout(r, 100));
  }
  const mine = calls.filter((c) => c.model === M);
  assert.deepEqual(mine.map((c) => c.input_tokens + c.output_tokens).sort(), [110, 220]);
  assert.equal((await call('/v1/ai/chat/completions', { token, body: { model: M, messages: msgs } })).status, 200);
  assert.equal((await call('/v1/ai/chat/completions', { token, body: { model: M, messages: msgs } })).status, 429);
});

test('cors: preflight allows the headers an allowed origin asks for', async () => {
  const pre = await fetch(base + '/v1/ai/chat/completions', { method: 'OPTIONS', headers: { origin: 'https://maxcembalest.com', 'access-control-request-headers': 'authorization, content-type, x-stainless-os, bad header!' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-headers'), 'authorization, content-type, x-stainless-os');
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
