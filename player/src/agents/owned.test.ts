import assert from 'node:assert/strict'
import { test } from 'node:test'
import { OwnedReader } from './owned.ts'

// A tiny ROM image: species names, type names, species info, experience tables at made-up addresses.
const ROM = 0x08000000
const SYM = { gSpeciesNames: 0x1000, gTypeNames: 0x2000, gSpeciesInfo: 0x3000, gExperienceTables: 0x4000 }
const rom = new Uint8Array(0x8000)
const enc = (s: string) => [...s].map(c => c >= 'A' && c <= 'Z' ? 0xBB + c.charCodeAt(0) - 65 : c >= 'a' && c <= 'z' ? 0xD5 + c.charCodeAt(0) - 97 : 0xFF)
const put = (at: number, bytes: number[]) => rom.set(bytes, at)
put(SYM.gSpeciesNames + 4 * 11, [...enc('CHARMANDER'), 0xFF])
put(SYM.gSpeciesNames + 7 * 11, [...enc('SQUIRTLE'), 0xFF])
put(SYM.gTypeNames + 10 * 7, [...enc('FIRE'), 0xFF, 0xFF, 0xFF])
put(SYM.gTypeNames + 11 * 7, [...enc('WATER'), 0xFF, 0xFF])
put(SYM.gTypeNames + 2 * 7, [...enc('FLYING'), 0xFF])
rom[SYM.gSpeciesInfo + 4 * 28 + 6] = 10; rom[SYM.gSpeciesInfo + 4 * 28 + 7] = 10; rom[SYM.gSpeciesInfo + 4 * 28 + 0x13] = 1 // Charmander: Fire/Fire, growth 1
rom[SYM.gSpeciesInfo + 7 * 28 + 6] = 11; rom[SYM.gSpeciesInfo + 7 * 28 + 7] = 2; rom[SYM.gSpeciesInfo + 7 * 28 + 0x13] = 0 // Squirtle: Water/Flying (for the test), growth 0
const view = new DataView(rom.buffer)
for (let rate = 0; rate < 6; rate++) for (let level = 0; level <= 100; level++) view.setUint32(SYM.gExperienceTables + (rate * 101 + level) * 4, (rate + 1) * level * level * level, true)

// RAM: party at 0x02024284, storage pointer at 0x03005010 → storage at 0x02029000.
const PARTY = 0x02024284, COUNT = 0x02024029, PTR = 0x03005010, STORAGE = 0x02029000
const ram = new Map<number, number>()
const mem = {
  u8: (a: number) => ram.get(a) ?? 0,
  u16: (a: number) => mem.u8(a) | mem.u8(a + 1) << 8,
  u32: (a: number) => (mem.u16(a) | mem.u16(a + 2) << 16) >>> 0,
}
const w8 = (a: number, v: number) => ram.set(a, v & 255)
const w32 = (a: number, v: number) => { for (let i = 0; i < 4; i++) w8(a + i, v >>> (8 * i)) }
const ORDER = ['GAEM', 'GAME', 'GEAM', 'GEMA', 'GMAE', 'GMEA', 'AGEM', 'AGME', 'AEGM', 'AEMG', 'AMGE', 'AMEG',
  'EGAM', 'EGMA', 'EAGM', 'EAMG', 'EMGA', 'EMAG', 'MGAE', 'MGEA', 'MAGE', 'MAEG', 'MEGA', 'MEAG']
function boxMon(base: number, o: { personality: number; otId: number; species: number; exp: number; nick: string; egg?: boolean }) {
  w32(base, o.personality); w32(base + 4, o.otId)
  const nick = enc(o.nick); for (let i = 0; i < 10; i++) w8(base + 8 + i, nick[i] ?? 0xFF)
  w8(base + 19, 2 | (o.egg ? 4 : 0))
  const key = (o.personality ^ o.otId) >>> 0
  const g = ORDER[o.personality % 24]!.indexOf('G') * 12
  w32(base + 32 + g, (o.species ^ key) >>> 0)
  w32(base + 32 + g + 4, (o.exp ^ key) >>> 0)
}
const symbols = Object.fromEntries([
  ...Object.entries(SYM).map(([k, v]) => [k, { address: ROM + v }]),
  ['gPlayerParty', { address: PARTY }], ['gPlayerPartyCount', { address: COUNT }], ['gPokemonStoragePtr', { address: PTR }],
])

test('party + boxes: species, nickname, types, level (party from the struct, boxes from experience)', () => {
  w8(COUNT, 2)
  boxMon(PARTY, { personality: 0x12345678, otId: 0xABCDEF01, species: 4, exp: 999, nick: 'FLAME' }); w8(PARTY + 0x54, 12)
  boxMon(PARTY + 100, { personality: 7, otId: 9, species: 7, exp: 0, nick: 'SQUIRTLE' }); w8(PARTY + 100 + 0x54, 5)
  w32(PTR, STORAGE)
  boxMon(STORAGE + 1 + 80 * 3, { personality: 0xDEADBEEF, otId: 1, species: 4, exp: 2 * 27 * 27 * 27, nick: 'Ember' }) // box 0 slot 3: growth 1 → 2·L³ = exp at L 27
  boxMon(STORAGE + 1 + 80 * (30 * 2 + 5), { personality: 23, otId: 5, species: 7, exp: 1000, nick: 'EGG', egg: true }) // an egg: skipped
  boxMon(STORAGE + 1 + 80 * (30 * 13 + 29), { personality: 1, otId: 2, species: 7, exp: 5 * 5 * 5 + 1, nick: 'LAST' })
  const r = new OwnedReader(mem, rom, symbols)
  const all = r.all()
  assert.deepEqual(all.map(m => [m.where, m.box, m.slot, m.name, m.nickname, m.level, m.types.join('/'), m.personality]), [
    ['party', -1, 0, 'CHARMANDER', 'FLAME', 12, 'FIRE', 0x12345678],
    ['party', -1, 1, 'SQUIRTLE', 'SQUIRTLE', 5, 'WATER/FLYING', 7],
    ['box', 0, 3, 'CHARMANDER', 'Ember', 27, 'FIRE', 0xDEADBEEF],
    ['box', 13, 29, 'SQUIRTLE', 'LAST', 5, 'WATER/FLYING', 1],
  ])
})

test('no storage pointer yet (title screen) → no boxes; level caps at 100', () => {
  w32(PTR, 0)
  const r = new OwnedReader(mem, rom, symbols)
  assert.deepEqual(r.boxes(), [])
  assert.equal(r.levelFor(4, 2 ** 31), 100)
  assert.equal(r.levelFor(4, 0), 1)
})
