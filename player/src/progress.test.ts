import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GbaMemory, fakeCore } from './bridge/memory.ts'
import { ProgressWatcher, readSnapshot, type ProgressSymbols } from './progress.ts'

const SYM: ProgressSymbols = { saveBlock1Ptr: 0x03005008, saveBlock2Ptr: 0x0300500c, partyCount: 0x02024029, party: 0x02024284 }
const SB1 = 0x0202552c, SB2 = 0x02024588

function game() {
  const memory = new GbaMemory(fakeCore())
  const at = { play: 0 }
  const setPlay = (s: number) => { memory.w16(SB2 + 0x0e, Math.floor(s / 3600)); memory.w8(SB2 + 0x10, Math.floor(s / 60) % 60); memory.w8(SB2 + 0x11, s % 60); at.play = s }
  const setMap = (g: number, n: number) => { memory.w8(SB1 + 4, g); memory.w8(SB1 + 5, n) }
  const setFlag = (f: number) => { const a = SB1 + 0xee0 + (f >> 3); memory.w8(a, memory.u8(a) | 1 << (f & 7)) }
  const setParty = (levels: number[]) => { memory.w8(SYM.partyCount, levels.length); levels.forEach((l, i) => memory.w8(SYM.party + i * 100 + 0x54, l)) }
  return { memory, setPlay, setMap, setFlag, setParty, at, ptrs: () => { memory.w32(SYM.saveBlock1Ptr, SB1); memory.w32(SYM.saveBlock2Ptr, SB2) } }
}

test('no snapshot until save blocks are set up', () => {
  const g = game()
  assert.equal(readSnapshot(g.memory, SYM), null)
  g.ptrs()
  assert.deepEqual(readSnapshot(g.memory, SYM), { play_s: 0, map: [0, 0], badges: 0, badge_count: 0, has_pokemon: false, champion: false, party: [] })
})

test('reads play time, map, badges, flags, party', () => {
  const g = game(); g.ptrs()
  g.setPlay(3 * 3600 + 25 * 60 + 7); g.setMap(3, 0x14); g.setFlag(0x820); g.setFlag(0x821); g.setFlag(0x828); g.setParty([14, 9])
  g.memory.w8(SB1 + 4, 0xff) // signed map group -1
  const s = readSnapshot(g.memory, SYM)!
  assert.equal(s.play_s, 12307)
  assert.deepEqual(s.map, [-1, 0x14])
  assert.equal(s.badges, 3); assert.equal(s.badge_count, 2)
  assert.equal(s.has_pokemon, true); assert.equal(s.champion, false)
  assert.deepEqual(s.party, [14, 9])
})

test('watcher: quiet until the clock runs; baseline, then only changes', () => {
  const g = game(); g.ptrs()
  const events: { kind: string; data?: any }[] = []
  const w = new ProgressWatcher(() => readSnapshot(g.memory, SYM), (kind, data) => events.push({ kind, data }), 60_000)
  // continue from a save that already has badge 1
  g.setPlay(100); g.setMap(3, 1); g.setFlag(0x820)
  w.tick(0); w.tick(1000)
  assert.equal(events.length, 0, 'clock not moving → title screen / paused')
  g.setPlay(101); w.tick(2000)
  assert.deepEqual(events.map(e => e.kind), ['snapshot'])
  assert.equal(events[0]!.data.badge_count, 1)
  g.setPlay(103); g.setMap(3, 2); w.tick(4000)
  g.setPlay(105); g.setFlag(0x821); w.tick(6000)
  g.setPlay(107); w.tick(8000) // nothing new
  g.setPlay(109); g.setFlag(0x82c); w.tick(10_000)
  assert.deepEqual(events.slice(1).map(e => e.kind), ['map', 'badge', 'champion'])
  assert.deepEqual(events[1]!.data, { map: [3, 2], play_s: 103 })
  assert.equal(events[2]!.data.n, 2)
  g.setPlay(200); w.tick(70_000)
  assert.equal(events.at(-1)!.kind, 'snapshot')
  w.finalSnapshot(71_000) // too soon after the last one
  assert.equal(events.filter(e => e.kind === 'snapshot').length, 2)
  w.finalSnapshot(80_000)
  assert.equal(events.filter(e => e.kind === 'snapshot').length, 3)
})
