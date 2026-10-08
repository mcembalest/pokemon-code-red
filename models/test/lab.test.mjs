import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FORMATS, example } from '../../rules/index.mjs'
import { VARIANTS } from '../lab/variants.mjs'
import { byName } from '../../rules/index.mjs'

test('formats round-trip', () => {
  for (const [t, f] of Object.entries(FORMATS)) for (const b of [[42, 13, 140], [10, 199, 57, 88, 23, 150, 61]]) assert.deepEqual(f.decode(f.encode(b)), b, t)
  assert.equal(example('ROCK'), '2a 0d 8c')
})

test('function judge: right code hits, wrong code misses', async () => {
  const foe = { name: 'GEODUDE', level: 12, types: ['ROCK', 'GROUND'], clean: [35, 146, 75, 105], dirty: [] }
  const v = VARIANTS['fn-format']
  assert.match(v.prompt({ move: byName.SLICE, foe }).user, /hex dump/)
  assert.equal((await v.judge({ move: byName.SLICE, foe, code: "function slice(data) { return data.split(' ').map(h => parseInt(h, 16)).slice(0, 3) }" })).outcome, 'hit')
  assert.equal((await v.judge({ move: byName.SLICE, foe, code: "function slice(data) { return data.split(' ').slice(0, 3) }" })).outcome, 'miss')
  assert.equal((await v.judge({ move: byName.SLICE, foe, code: 'const x = 1' })).outcome, 'miss')
  assert.equal((await v.judge({ move: byName.SLICE, foe, code: "const b = data.split(' ').map(h => parseInt(h, 16))\nreturn b.slice(0, 3)" })).outcome, 'hit')
  assert.equal((await v.judge({ move: byName.SLICE, foe, code: "const b = data.split(' ').map(h => parseInt(h, 16))\nfunction slice(data) { return b.slice(0, 3) }" })).outcome, 'hit')
  const s = VARIANTS['format-steps']
  assert.equal((await s.judge({ move: byName.PING, foe, code: "const f = await tools.scan()\nawait tools.ping({ key: f.data.split(' ').length })" })).outcome, 'hit')
})
