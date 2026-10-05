import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyIps, sha1 } from './patch.ts'

const record = Uint8Array.from([80, 65, 84, 67, 72, 0, 0, 1, 0, 2, 8, 9, 69, 79, 70])
test('IPS edits the requested bytes without changing the input', () => {
  const base = Uint8Array.from([1, 2, 3, 4])
  assert.deepEqual(applyIps(base, record), Uint8Array.from([1, 8, 9, 4]))
  assert.deepEqual(base, Uint8Array.from([1, 2, 3, 4]))
})
test('IPS rejects truncated and out-of-bounds records and unexpected trailers', () => {
  const base = Uint8Array.from([1, 2, 3, 4])
  assert.throws(() => applyIps(base, record.subarray(0, 11)), /patch/)
  assert.throws(() => applyIps(new Uint8Array(2), record), /record/)
  assert.throws(() => applyIps(base, Uint8Array.from([...record, 1])), /trailer/)
  assert.throws(() => applyIps(base, Uint8Array.from([1, 2, 3])), /header/)
})
test('browser checksum agrees with a known SHA-1', async () => {
  assert.equal(await sha1(new TextEncoder().encode('abc')), 'a9993e364706816aba3e25717850c26c9cd0d89d')
})
