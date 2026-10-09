import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BackendError, type CloudSave } from './backend.ts'
import { CloudSync, decideRestore, localSyncMark } from './cloud.ts'
import type { SaveGame } from './saves.ts'

test('decideRestore: cloud wins when there is no local save or when another device saved since', () => {
  assert.equal(decideRestore(false, 0, null), 'none')
  assert.equal(decideRestore(true, 0, null), 'local')
  assert.equal(decideRestore(false, 0, { version: 3 }), 'cloud')
  assert.equal(decideRestore(true, 3, { version: 3 }), 'local')  // this device made v3
  assert.equal(decideRestore(true, 3, { version: 4 }), 'cloud')  // someone else made v4
  assert.equal(decideRestore(true, 0, { version: 1 }), 'cloud')  // local save from before accounts: the cloud copy is the account's
})

function fakeGame(exists = false) {
  const files: Record<string, Uint8Array> = {}
  const dirs = new Set<string>()
  const path = '/data/saves/Pokemon Code Red.srm'
  if (exists) files[path] = new Uint8Array([9])
  const calls: string[] = []
  const game: SaveGame = {
    FS: {
      analyzePath: p => ({ exists: p in files || dirs.has(p) }),
      mkdir: p => { dirs.add(p) },
      writeFile: (p, data) => { files[p] = data },
    },
    getSaveFilePath: () => path,
    getSaveFile: () => files[path] ?? null,
    saveSaveFiles: () => { calls.push('save') },
    loadSaveFiles: () => { calls.push('load') },
    restart: () => { calls.push('restart') },
  }
  return { game, files, calls, path }
}

function fakeBackend(cloud: CloudSave | null, opts: { putStatus?: number } = {}) {
  const puts: { sram: Uint8Array; minds: unknown }[] = []
  let active = true
  let me: 'ok' | 'inactive' = 'ok'
  return {
    puts, setMe(v: 'ok' | 'inactive') { me = v },
    backend: {
      get active() { return active },
      async getSave() { return cloud },
      async putSave(save: { sram: Uint8Array; minds: unknown }) {
        if (opts.putStatus) { if (opts.putStatus === 409) active = false; throw new BackendError(opts.putStatus, 'nope') }
        puts.push(save); return { version: puts.length + (cloud?.version ?? 0), same_sram: false }
      },
      async check() { return me },
    },
  }
}

const mark = (v = 0) => { let n = v; return { get: () => n, set: (x: number) => { n = x } } }

test('restore: no local save → cloud save installed, minds imported, version marked', async () => {
  const { game, files, calls, path } = fakeGame(false)
  let imported: unknown
  const m = mark()
  const sync = new CloudSync({ game, backend: fakeBackend({ version: 2, at: 1, rom: 'r', sram: new Uint8Array([1, 2, 3]), minds: { hot: { 5: 'x' } } }).backend, minds: { import: s => { imported = s } }, mark: m })
  assert.equal(await sync.restore(), 'cloud')
  assert.deepEqual([...files[path]!], [1, 2, 3])
  assert.deepEqual(calls, ['load', 'restart'])
  assert.deepEqual(imported, { hot: { 5: 'x' } })
  assert.equal(m.get(), 2)
})

test('restore: local save already synced → kept; offline → offline', async () => {
  const { game, calls } = fakeGame(true)
  const sync = new CloudSync({ game, backend: fakeBackend({ version: 2, at: 1, rom: null, sram: new Uint8Array([1]), minds: {} }).backend, minds: {}, mark: mark(2) })
  assert.equal(await sync.restore(), 'local')
  assert.deepEqual(calls, [])
  const off = new CloudSync({ game, backend: { ...fakeBackend(null).backend, async getSave() { throw new BackendError(0, 'down') } }, minds: {}, mark: mark() })
  assert.equal(await off.restore(), 'offline')
})

test('changed: uploads sram + minds, marks the version; bursts coalesce to the latest bytes', async () => {
  const { game } = fakeGame(true)
  const fb = fakeBackend(null)
  const m = mark()
  const synced: number[] = []
  const sync = new CloudSync({ game, backend: fb.backend, minds: { export: () => ({ hot: { 1: 'brave' } }) }, mark: m, rom: 'abc', onSynced: v => synced.push(v) })
  void sync.changed(new Uint8Array([1]))
  void sync.changed(new Uint8Array([2]))
  await sync.changed(new Uint8Array([3]))
  assert.ok(fb.puts.length >= 1 && fb.puts.length <= 2, String(fb.puts.length))
  assert.deepEqual([...fb.puts.at(-1)!.sram], [3])
  assert.deepEqual(fb.puts[0]!.minds, { hot: { 1: 'brave' } })
  assert.equal(m.get(), fb.puts.length)
  assert.deepEqual(synced, fb.puts.map((_, i) => i + 1))
})

test('takeover: a 409 upload or active:false from /v1/me fires onActive(false) once; resumed() fires true', async () => {
  const { game } = fakeGame(true)
  const fb = fakeBackend(null, { putStatus: 409 })
  const states: boolean[] = []
  const sync = new CloudSync({ game, backend: fb.backend, minds: {}, mark: mark(), onActive: a => states.push(a) })
  await sync.changed(new Uint8Array([1]))
  await sync.changed(new Uint8Array([2])) // inactive now: no second upload attempt, no second callback
  assert.deepEqual(states, [false])
  sync.resumed()
  assert.deepEqual(states, [false, true])
  fb.setMe('inactive')
  const stop = sync.watchActive(5)
  await new Promise(r => setTimeout(r, 30))
  stop()
  assert.deepEqual(states, [false, true, false])
})

test('localSyncMark survives bad storage', () => {
  const m = localSyncMark(null)
  assert.equal(m.get(), 0); m.set(3); assert.equal(m.get(), 0)
  const store: Record<string, string> = {}
  const m2 = localSyncMark({ getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v } })
  m2.set(7); assert.equal(m2.get(), 7)
})
