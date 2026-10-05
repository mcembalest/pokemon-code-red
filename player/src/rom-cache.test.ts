import assert from 'node:assert/strict'
import { test } from 'node:test'
import { restoreRom } from './rom-cache.ts'
import { BASE_SHA1, ROM_SIZE } from './patch.ts'
import { romKey, SOURCE_KEY } from './storage.ts'

const MOD_SHA1 = 'c0de4ed0000000000000000000000000000000000'
const ROM_KEY = romKey(MOD_SHA1)
const STATE_KEY = `state:${MOD_SHA1}:legacy`

const bytes = (tag: number) => { const result = new Uint8Array(ROM_SIZE); result[0] = tag; return result }
const digest = async (value: Uint8Array) => value[0] === 1 ? BASE_SHA1 : value[0] === 2 ? MOD_SHA1 : 'invalid'
function fixture(entries: [string, ArrayBuffer][] = []) {
  const files = new Map(entries)
  let patches = 0
  const cache = {
    read: async (key: string) => files.get(key),
    write: async (key: string, value: Uint8Array) => { files.set(key, value.slice().buffer) },
    patch: async (source: Uint8Array) => { assert.equal(source[0], 1); patches++; return bytes(2) },
  }
  return { files, cache, patches: () => patches }
}
test('reload reuses existing current patched cache without changing saves', async () => {
  const state = new ArrayBuffer(4)
  const f = fixture([[ROM_KEY, bytes(2).buffer], [STATE_KEY, state]])
  assert.equal((await restoreRom(f.cache, MOD_SHA1, digest))?.bytes[0], 2)
  assert.equal(f.patches(), 0); assert.equal(f.files.get(STATE_KEY), state)
  assert.equal(f.files.has(SOURCE_KEY), false)
})
test('patch upgrade rebuilds from stable source, caches current build and leaves old ROM/state untouched', async () => {
  const old = bytes(3).buffer, state = new ArrayBuffer(4), source = bytes(1).buffer
  const f = fixture([[SOURCE_KEY, source], ['rom:old-build', old], ['state:old-build:old-core', state]])
  assert.equal((await restoreRom(f.cache, MOD_SHA1, digest))?.remembered, true)
  assert.equal(f.patches(), 1); assert.equal(f.files.get(SOURCE_KEY), source)
  assert.equal(f.files.get('rom:old-build'), old); assert.equal(f.files.get('state:old-build:old-core'), state)
  await restoreRom(f.cache, MOD_SHA1, digest); assert.equal(f.patches(), 1)
})
test('missing, evicted, wrong-sized and corrupt data prompt for source; corrupt current falls back to source', async () => {
  for (const entries of [[], [[SOURCE_KEY, new ArrayBuffer(1)]], [[SOURCE_KEY, bytes(3).buffer]], [['rom:old-build', bytes(2).buffer]]] as [string, ArrayBuffer][][]) {
    const f = fixture(entries); assert.equal(await restoreRom(f.cache, MOD_SHA1, digest), undefined); assert.equal(f.patches(), 0)
  }
  const f = fixture([[ROM_KEY, bytes(3).buffer], [SOURCE_KEY, bytes(1).buffer]])
  assert.equal((await restoreRom(f.cache, MOD_SHA1, digest))?.bytes[0], 2)
})
test('storage rejection allows choice; derived-cache write rejection still plays from retained source', async () => {
  const f = fixture([[SOURCE_KEY, bytes(1).buffer]])
  f.cache.write = async () => { throw new Error('quota') }
  assert.equal((await restoreRom(f.cache, MOD_SHA1, digest))?.remembered, true)
  f.cache.read = async () => { throw new Error('blocked') }
  assert.equal(await restoreRom(f.cache, MOD_SHA1, digest), undefined)
})
test('patch failures and invalid output preserve source for reload retry', async () => {
  const source = bytes(1).buffer, f = fixture([[SOURCE_KEY, source]])
  f.cache.patch = async () => { throw new Error('offline') }
  await assert.rejects(restoreRom(f.cache, MOD_SHA1, digest), /offline/)
  f.cache.patch = async () => bytes(3)
  await assert.rejects(restoreRom(f.cache, MOD_SHA1, digest), /verification/)
  assert.equal(f.files.get(SOURCE_KEY), source); assert.equal(f.files.has(ROM_KEY), false)
})
