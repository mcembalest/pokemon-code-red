import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GbaMemory, fakeCore } from '../bridge/memory.ts'
import { offeredStarter, starterCardHtml } from './starter-card.ts'

const SYM = { gTasks: 0x03005090, monPicTask: 0x0809d2bd, saveBlock1Ptr: 0x03005008 }
const SB1 = 0x0202552c

test('offeredStarter: monpic task active + in the lab + VAR_TEMP_2', () => {
  const m = new GbaMemory(fakeCore())
  m.w32(SYM.saveBlock1Ptr, SB1); m.w8(SB1 + 4, 4); m.w8(SB1 + 5, 3); m.w16(SB1 + 0x1000 + 4, 4)
  assert.equal(offeredStarter(m, SYM), null, 'no monpic yet')
  m.w32(SYM.gTasks + 3 * 40, 0x0809d2bc); m.w8(SYM.gTasks + 3 * 40 + 4, 1)
  assert.equal(offeredStarter(m, SYM), 4)
  m.w8(SB1 + 5, 4)
  assert.equal(offeredStarter(m, SYM), null, 'other map')
  m.w8(SB1 + 5, 3); m.w16(SB1 + 0x1000 + 4, 25)
  assert.equal(offeredStarter(m, SYM), null, 'not a starter')
  m.w16(SB1 + 0x1000 + 4, 7); m.w8(SYM.gTasks + 3 * 40 + 4, 0)
  assert.equal(offeredStarter(m, SYM), null, 'task ended')
})

test('card lists the starter scripts', () => {
  const html = starterCardHtml(7)
  assert.match(html, /SQUIRTLE/)
  assert.match(html, /tackle\.js/); assert.match(html, /tail_whip\.js/)
  assert.match(html, /Knows 2 of 4 scripts/)
})
