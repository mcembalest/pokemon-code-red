import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GbaMemory, fakeCore, EWRAM, IWRAM } from './memory.ts'
import { NamingMailbox, NAMING_MAGIC } from './naming.ts'

const NAME = 0x02039990

function setup() {
  const core = fakeCore()
  const memory = new GbaMemory(core)
  return { core, memory }
}
test('memory: EWRAM and IWRAM map to the right heap regions; out of range throws', () => {
  const { core, memory } = setup()
  memory.w32(EWRAM.base + 0x10, 0xdeadbeef)
  assert.equal(memory.u32(EWRAM.base + 0x10), 0xdeadbeef)
  assert.deepEqual([...core.HEAPU8.subarray(core._ejs_cr_ewram() + 0x10, core._ejs_cr_ewram() + 0x14)], [0xef, 0xbe, 0xad, 0xde])
  memory.w16(IWRAM.base + 4, 0x1234)
  assert.equal(core.HEAPU8[core._ejs_cr_iwram() + 4], 0x34)
  assert.throws(() => memory.read(EWRAM.base + EWRAM.size - 2, 4), RangeError)
  assert.throws(() => memory.read(0x08000000, 1), RangeError)
})

test('memory: wrong ABI is rejected', () => {
  const core = { ...fakeCore(), _ejs_cr_abi: () => 2 }
  assert.throws(() => new GbaMemory(core), /ABI 2/)
})

function activeNaming(memory: GbaMemory, session = 5, current = 'RED') {
  memory.w32(NAME, NAMING_MAGIC); memory.w16(NAME + 4, 1); memory.w8(NAME + 6, 1); memory.w8(NAME + 7, 7)
  memory.w32(NAME + 8, session); memory.w8(NAME + 27, current.length)
  memory.write(NAME + 28, [...current].map(c => c.charCodeAt(0)))
}

test('naming: snapshot reads the active screen', () => {
  const { memory } = setup()
  const box = new NamingMailbox(memory, NAME)
  assert.equal(box.snapshot(), null)
  activeNaming(memory)
  assert.deepEqual(box.snapshot(), { maxLength: 7, session: 5, sequence: 0, ackSequence: 0, action: 0, status: 0, current: 'RED' })
  memory.w8(NAME + 6, 0)
  assert.equal(box.snapshot(), null, 'inactive')
})

test('naming: write publishes input then action; rejects stale/invalid', () => {
  const { core, memory } = setup()
  activeNaming(memory)
  const box = new NamingMailbox(memory, NAME)
  assert.equal(box.write(1, 5, 1, 1, 'Ab 12?!'), true)
  assert.equal(memory.u8(NAME + 24), 1)
  assert.equal(memory.u32(NAME + 12), 5)
  assert.equal(memory.u8(NAME + 25), 7)
  assert.equal(String.fromCharCode(...memory.read(NAME + 44, 7)), 'Ab 12?!')
  assert.equal(box.write(1, 5, 1, 1, 'x'), false, 'sequence must increase while pending')
  assert.equal(box.write(1, 6, 2, 1, 'x'), false, 'wrong session')
  assert.equal(box.write(1, 5, 2, 1, '{bad}'), false, 'charset')
  assert.equal(box.write(1, 5, 2, 1, 'toolong!'), false, 'max length')
  core.bump()
  assert.equal(box.write(1, 5, 2, 1, 'x'), false, 'stale epoch')
  memory.w32(NAME + 20, 9)
  assert.equal(box.write(2, 5, 9, 2, ''), false, 'sequence must exceed ack')
  assert.equal(box.write(2, 5, 10, 2, ''), true)
})
