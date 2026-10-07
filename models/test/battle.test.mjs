import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rng } from '../contracts.mjs'
import { MOVES } from '../battle/moves.mjs'
import { TYPES, FOES, cleanBytes, dirty, cleanup } from '../battle/types.mjs'

test('every foe type: cleanup undoes its junk exactly', () => {
  const combos = [...new Set(FOES.map(([, t]) => t.join('/')))].map(s => s.split('/'))
  for (const types of combos) for (let seed = 0; seed < 300; seed++) {
    const r = rng(seed * 7919 + types.length)
    const clean = cleanBytes(r, types)
    const raw = dirty(r, types, clean)
    assert.deepEqual(cleanup(types, raw), clean, `${types} seed ${seed}: ${JSON.stringify(raw)}`)
    if (types.join() !== 'NORMAL') assert.notDeepEqual(raw, clean, `${types} seed ${seed}: no junk added`)
  }
  assert.ok(Object.keys(TYPES).length >= 13)
})

test('103 moves: unique names and functions, ≤ 12 chars, every answer computable', () => {
  assert.equal(MOVES.length, 103)
  assert.equal(new Set(MOVES.map(m => m.name)).size, 103)
  assert.equal(new Set(MOVES.map(m => m.fn)).size, 103)
  for (const m of MOVES) assert.ok(m.name.length <= 12, m.name)
  const foe = { name: 'ONIX', level: 12, types: ['ROCK', 'GROUND'], status: 'none', bytes: [9, 255, 30] }
  for (const m of MOVES) for (const b of [[12, 40, 7, 33], [150, 11, 99, 64, 23, 180, 71]]) assert.doesNotThrow(() => JSON.stringify(m.ref(b, foe)), m.name)
  assert.equal(MOVES.find(m => m.name === 'SLICE').ref([1, 2, 3, 4]).join(), '1,2,3')
  assert.equal(MOVES.find(m => m.name === 'ERRORMSG').ref([1, 2, 3]), 'ERROR 3')
})
