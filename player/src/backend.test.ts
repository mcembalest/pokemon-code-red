import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Backend, fromBase64, toBase64, type Session, type SessionStore } from './backend.ts'

function memoryStore(initial: Session | null = null): SessionStore & { value: Session | null } {
  return { value: initial, get() { return this.value }, set(s) { this.value = s } }
}
type Call = { url: string; init?: RequestInit }
function fakeHttp(responder: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = []
  const http = (async (url: string, init?: RequestInit) => { const c = { url, init }; calls.push(c); return responder(c) }) as typeof fetch
  return { http, calls }
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const SESSION: Session = { token: 'tok', player: { id: 'p1', name: 'Ash', username: 'ash' }, active: true }

test('join stores the session; bad invite gives a clear error', async () => {
  const store = memoryStore()
  const { http, calls } = fakeHttp(c => JSON.parse(String(c.init!.body)).invite === 'RED-GOOD-CODE'
    ? json({ token: 'tok', player: { id: 'p1', name: 'Ash', username: 'ash', created_at: 1 }, active: true }, 201)
    : json({ error: 'invite not valid' }, 403))
  const b = new Backend('https://api.test/', store, http)
  await assert.rejects(b.join('RED-BAD', 'Ash', 'ash', 'pikachu-123'), /not valid/)
  assert.equal(store.value, null)
  const s = await b.join(' RED-GOOD-CODE ', ' Ash ', ' ash ', 'pikachu-123')
  assert.deepEqual(s, SESSION)
  assert.deepEqual(store.value, SESSION)
  assert.equal(calls[1]!.url, 'https://api.test/v1/join')
  assert.deepEqual(JSON.parse(String(calls[1]!.init!.body)), { invite: 'RED-GOOD-CODE', name: 'Ash', username: 'ash', password: 'pikachu-123' })
})

test('join while offline', async () => {
  const b = new Backend('https://api.test', memoryStore(), (async () => { throw new TypeError('fetch failed') }) as typeof fetch)
  await assert.rejects(b.join('x', 'y', 'z', 'w'), /Could not reach/)
})

test('track is a no-op without a session', async () => {
  const { http, calls } = fakeHttp(() => json({}))
  const b = new Backend('https://api.test', memoryStore(), http)
  b.track('snapshot', {}); await b.flush()
  assert.equal(b.pending, 0); assert.equal(calls.length, 0)
})

test('flush sends batches with auth; retries on network/5xx; drops on 400; clears session on 401', async () => {
  let mode: 'ok' | 'down' | '500' | '400' | '401' = 'down'
  const { http, calls } = fakeHttp(() => {
    if (mode === 'down') throw new TypeError('offline')
    return json({}, { ok: 200, '500': 500, '400': 400, '401': 401 }[mode])
  })
  const store = memoryStore({ ...SESSION })
  const b = new Backend('https://api.test', store, http)
  for (let i = 0; i < 250; i++) b.track('map', { i }, 1000 + i)
  await b.flush(); assert.equal(b.pending, 250)
  mode = '500'; await b.flush(); assert.equal(b.pending, 250)
  mode = 'ok'; await b.flush(); assert.equal(b.pending, 0)
  const sent = calls.filter(c => c.init?.method === 'POST').slice(-2)
  assert.equal((sent[0]!.init!.headers as Record<string, string>).authorization, 'Bearer tok')
  assert.deepEqual(JSON.parse(String(sent[0]!.init!.body)).events.length, 200)
  assert.deepEqual(JSON.parse(String(sent[1]!.init!.body)).events[49], { kind: 'map', at: 1249, data: { i: 249 } })
  mode = '400'; b.track('x'); await b.flush(); assert.equal(b.pending, 0)
  mode = '401'; b.track('x'); await b.flush(); assert.equal(store.value, null)
})

test('flushOnHide uses a beacon with the token in the body', async () => {
  const beacons: { url: string; body: Blob }[] = []
  const b = new Backend('https://api.test', memoryStore({ ...SESSION }), fakeHttp(() => json({})).http, (url, body) => { beacons.push({ url, body }); return true })
  b.track('snapshot', { play_s: 5 }, 42)
  b.flushOnHide()
  assert.equal(b.pending, 0)
  assert.equal(beacons[0]!.url, 'https://api.test/v1/events')
  assert.equal(beacons[0]!.body.type, 'text/plain')
  assert.deepEqual(JSON.parse(await beacons[0]!.body.text()), { token: 'tok', events: [{ kind: 'snapshot', at: 42, data: { play_s: 5 } }] })
})

test('features: stored on join, refreshed by check', async () => {
  const store = memoryStore()
  let agents = true
  const { http } = fakeHttp(c => c.url.endsWith('/v1/join')
    ? json({ token: 't', player: { id: 'p', name: 'A' }, features: { agents } }, 201)
    : json({ player: { id: 'p', name: 'A' }, features: { agents } }))
  const b = new Backend('https://api.test', store, http)
  await b.join('RED-X', 'A', 'a', 'password1')
  assert.deepEqual(store.value?.features, { agents: true })
  agents = false
  assert.equal(await b.check(), 'ok')
  assert.deepEqual(store.value?.features, { agents: false })
})

test('check: invalid token clears the session; offline keeps it', async () => {
  let status = 401
  const store = memoryStore({ ...SESSION })
  const b = new Backend('https://api.test', store, fakeHttp(() => json({}, status)).http)
  status = 503; assert.equal(await b.check(), 'offline'); assert.ok(store.value)
  status = 200; assert.equal(await b.check(), 'ok')
  status = 401; assert.equal(await b.check(), 'invalid'); assert.equal(store.value, null)
})

test('login: wrong password, rate limit, success (this device becomes active)', async () => {
  let status = 401
  const store = memoryStore()
  const b = new Backend('https://api.test', store, fakeHttp(() => status === 200
    ? json({ token: 't2', player: { id: 'p1', name: 'Ash', username: 'ash' }, active: true, features: { agents: true } })
    : json({ error: 'nope' }, status)).http)
  await assert.rejects(b.login('ash', 'bad'), /Wrong username or password/)
  status = 429; await assert.rejects(b.login('ash', 'bad'), /Too many attempts/)
  status = 200
  const s = await b.login(' ash ', 'pikachu-123')
  assert.equal(s.token, 't2'); assert.equal(s.active, true); assert.equal(b.active, true)
  assert.deepEqual(store.value?.features, { agents: true })
})

test('check: another device took over → inactive; cached on the session', async () => {
  const store = memoryStore({ ...SESSION })
  const b = new Backend('https://api.test', store, fakeHttp(() => json({ player: { id: 'p1', name: 'Ash', username: 'ash' }, active: false, features: { agents: true } })).http)
  assert.equal(await b.check(), 'inactive')
  assert.equal(b.active, false)
  assert.equal(store.value?.active, false)
})

test('saves: PUT sends base64 sram + minds; 409 marks this device inactive; GET decodes', async () => {
  const store = memoryStore({ ...SESSION })
  let status = 200
  const sram = new Uint8Array([0, 1, 2, 250, 255])
  const { http, calls } = fakeHttp(c => c.init?.method === 'PUT'
    ? (status === 200 ? json({ version: 3, at: 5, same_sram: false }) : json({ error: 'not active' }, status))
    : json({ version: 3, at: 5, rom: 'abc', sram: toBase64(sram), minds: { hot: { 7: 'hi' } } }))
  const b = new Backend('https://api.test', store, http)
  const put = await b.putSave({ sram, minds: { hot: { 7: 'hi' } }, rom: 'abc' })
  assert.deepEqual(put, { version: 3, same_sram: false })
  const sent = JSON.parse(String(calls[0]!.init!.body))
  assert.equal(sent.sram, toBase64(sram)); assert.deepEqual(sent.minds, { hot: { 7: 'hi' } }); assert.equal(sent.rom, 'abc')
  assert.equal(calls[0]!.init!.headers!['authorization' as keyof HeadersInit], 'Bearer tok')
  const got = await b.getSave()
  assert.equal(got?.version, 3); assert.deepEqual([...got!.sram], [...sram]); assert.deepEqual(got?.minds, { hot: { 7: 'hi' } })
  status = 409
  await assert.rejects(b.putSave({ sram, minds: {} }), /not active/)
  assert.equal(b.active, false)
})

test('base64 round trip on a 128 KB save', () => {
  const big = new Uint8Array(128 * 1024).map((_, i) => (i * 31) & 255)
  const text = toBase64(big)
  assert.ok(text.length < 200 * 1024)
  assert.deepEqual(fromBase64(text), big)
})
