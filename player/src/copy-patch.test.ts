import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyCopyPatch } from './copy-patch.ts'
import { ROM_SIZE } from './patch.ts'
function patch(source: number, length: number, size = ROM_SIZE): Uint8Array {
  const bytes = new Uint8Array(21); bytes.set(new TextEncoder().encode('CRCP1'))
  const view = new DataView(bytes.buffer)
  view.setUint32(5, size, true); view.setUint32(9, 1, true)
  view.setUint32(13, source, true); view.setUint32(17, length, true)
  return bytes
}
test('copy-only patch reconstructs from local source without mutating it', () => {
  const base = new Uint8Array(ROM_SIZE); base[12345] = 72
  const output = applyCopyPatch(base, patch(0, ROM_SIZE))
  assert.deepEqual(output, base); assert.notEqual(output.buffer, base.buffer)
})
test('copy patch rejects corruption, source overrun, output underfill and forged count', () => {
  const base = new Uint8Array(ROM_SIZE)
  for (const bad of [patch(1, ROM_SIZE), patch(0, 0), patch(0, ROM_SIZE - 1), patch(0, ROM_SIZE, 1), patch(0, ROM_SIZE).subarray(0, 20)]) assert.throws(() => applyCopyPatch(base, bad))
  const bad = patch(0, ROM_SIZE); new DataView(bad.buffer).setUint32(9, 0xffffffff, true)
  assert.throws(() => applyCopyPatch(base, bad))
})
