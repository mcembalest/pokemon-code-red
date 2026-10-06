import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Backend, type Session, type SessionStore } from './backend.ts'

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
const SESSION: Session = { token: 'tok', player: { id: 'p1', name: 'Ash' } }

test('join stores the session; bad invite gives a clear error', async () => {
  const store = memoryStore()
  const { http, calls } = fakeHttp(c => JSON.parse(String(c.init!.body)).invite === 'RED-GOOD-CODE'
    ? json({ token: 'tok', player: { id: 'p1', name: 'Ash', created_at: 1 } }, 201)
    : json({ error: 'invite not valid' }, 403))
  const b = new Backend('https://api.test/', store, http)
  await assert.rejects(b.join('RED-BAD', 'Ash'), /not valid/)
  assert.equal(store.value, null)
  const s = await b.join(' RED-GOOD-CODE ', ' Ash ')
  assert.deepEqual(s, SESSION)
  assert.deepEqual(store.value, SESSION)
  assert.equal(calls[1]!.url, 'https://api.test/v1/join')
})

test('join while offline', async () => {
  const b = new Backend('https://api.test', memoryStore(), (async () => { throw new TypeError('fetch failed') }) as typeof fetch)
  await assert.rejects(b.join('x', 'y'), /Could not reach/)
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

test('check: invalid token clears the session; offline keeps it', async () => {
  let status = 401
  const store = memoryStore({ ...SESSION })
  const b = new Backend('https://api.test', store, fakeHttp(() => json({}, status)).http)
  status = 503; assert.equal(await b.check(), 'offline'); assert.ok(store.value)
  status = 200; assert.equal(await b.check(), 'ok')
  status = 401; assert.equal(await b.check(), 'invalid'); assert.equal(store.value, null)
})
