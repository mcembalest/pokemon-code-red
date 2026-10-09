import assert from 'node:assert/strict'
import { test } from 'node:test'
import { actionId, battleSpec, decodeText, greedyPolicy, observe, type BattleMon } from './battle.ts'
import { checkSpec } from './agent.ts'

const enc = (s: string) => Uint8Array.from([...s].map(c => c === ' ' ? 0 : c >= 'A' && c <= 'Z' ? 0xBB + c.charCodeAt(0) - 65 : c >= 'a' && c <= 'z' ? 0xD5 + c.charCodeAt(0) - 97 : c >= '0' && c <= '9' ? 0xA1 + c.charCodeAt(0) - 48 : 0xAE).concat([0xFF, 0x12]))

test('decodeText: FireRed charmap', () => {
  assert.equal(decodeText(enc('THUNDER Shock 9')), 'THUNDER Shock 9')
  assert.equal(decodeText(Uint8Array.from([0xBB, 0x1B, 0xFF])), 'Aé')
})

test('actionId: valid tool names from move names', () => {
  assert.equal(actionId('THUNDERSHOCK'), 'thundershock')
  assert.equal(actionId('DOUBLE-EDGE'), 'double_edge')
  assert.equal(actionId('SOFTBOILED.'), 'softboiled')
})

const ME: BattleMon = { species: 4, name: 'CHARMANDER', level: 5, hp: 19, maxHp: 19, types: ['FIRE'], moves: [
  { slot: 0, id: 10, name: 'SCRATCH', type: 'NORMAL', typeId: 0, power: 40, accuracy: 100, pp: 35, maxPp: 35 },
  { slot: 1, id: 45, name: 'GROWL', type: 'NORMAL', typeId: 0, power: 0, accuracy: 100, pp: 40, maxPp: 40 },
  { slot: 2, id: 52, name: 'EMBER', type: 'FIRE', typeId: 10, power: 40, accuracy: 100, pp: 0, maxPp: 25 },
] }
const FOE: BattleMon = { ...ME, species: 7, name: 'SQUIRTLE', hp: 12, types: ['WATER'], moves: [] }

test('battleSpec: one action per usable move (≤4)', () => {
  const spec = battleSpec(ME)
  checkSpec(spec)
  assert.deepEqual(spec.actions.map(a => a.id), ['scratch', 'growl'])  // EMBER has no PP
  assert.match(spec.actions[1]!.description, /^Run growl.js \(GROWL\).*status script/)
  assert.match(spec.actions[0]!.description, /Source:\nconst { me, foe, move } = input/)
  assert.match(observe(ME, FOE, true), /^Trainer battle\. Foe: SQUIRTLE Lv5, bytes left 12\/19, type WATER\.\nYou: CHARMANDER/)
  assert.match(observe(ME, FOE, true, '"THUD " (5 bytes)'), /Last output that landed in your context: "THUD "/)
  assert.match(battleSpec(ME).persona, /Hot-headed.*byte budget/)
})

test('greedy baseline picks the strongest usable move', () => {
  const spec = battleSpec(ME)
  assert.equal(greedyPolicy(ME.moves)({ spec, observation: { text: '' }, history: [] }).action, 'scratch')
})
