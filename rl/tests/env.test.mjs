import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extractCode, promptFor, scoreCompletion } from '../env/evaluate.mjs'
import { makeFoe } from '../env/contracts.mjs'

const block = code => '```js\n' + code + '\n```'

test('format: exactly one code block, no prose', () => {
  assert.equal(extractCode(block('return 1')).code, 'return 1')
  assert.equal(extractCode('```javascript\nreturn 1\n```').code, 'return 1')
  assert.match(extractCode('Sure! ' + block('return 1')).reason, /prose/)
  assert.match(extractCode('return 1').reason, /no code block/)
  assert.match(extractCode(block('a') + '\n' + block('b')).reason, /more than one|prose/)
})

test('SCRATCH: correct → hit/crit; wrong slots → miss; crash → miss; over budget → miss', async () => {
  const good = `const f = await tools.scan()\nconst s = f.bytes.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]).slice(0, 3)\nfor (const [, i] of s) await tools.scratch({ slot: i })`
  const r = await scoreCompletion({ move: 'SCRATCH', seed: 7, completion: block(good) })
  assert.equal(r.outcome, 'crit', JSON.stringify(r))
  const verbose = `// fire fire fire\n// let me think about the bytes very carefully here before scratching anything at all\nconst f = await tools.scan()\nawait tools.scan()\nconst s = f.bytes.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]).slice(0, 3)\nfor (const [, i] of s) await tools.scratch({ slot: i })`
  assert.equal((await scoreCompletion({ move: 'SCRATCH', seed: 7, completion: block(verbose) })).outcome, 'hit')
  const wrong = `await tools.scan(); await tools.scratch({ slot: 0 }); await tools.scratch({ slot: 1 }); await tools.scratch({ slot: 2 })`
  const foe = makeFoe(7)
  const lowest = foe.bytes.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]).slice(0, 3).map(x => x[1]).sort().join()
  if (lowest !== '0,1,2') assert.equal((await scoreCompletion({ move: 'SCRATCH', seed: 7, completion: block(wrong) })).outcome, 'miss')
  const crash = await scoreCompletion({ move: 'SCRATCH', seed: 7, completion: block('const f = await tools.scan(); f.bytes.sortt()') })
  assert.equal(crash.outcome, 'miss'); assert.match(crash.reason, /script/)
  const spam = await scoreCompletion({ move: 'SCRATCH', seed: 7, completion: block('for (let i = 0; i < 20; i++) await tools.scan()') })
  assert.equal(spam.reason, 'over byte budget')
  const loop = await scoreCompletion({ move: 'SCRATCH', seed: 7, completion: block('while (true) {}') })
  assert.match(loop.reason, /timeout/)
})

test('TACKLE / GROWL / TAIL WHIP judges', async () => {
  const t = await scoreCompletion({ move: 'TACKLE', seed: 3, completion: block('const { bytes } = await tools.scan()\nawait tools.tackle({ force: bytes.reduce((a, b) => a + b, 0) })') })
  assert.equal(t.outcome, 'crit', JSON.stringify(t))
  const g = await scoreCompletion({ move: 'GROWL', seed: 3, completion: block('const s = await tools.stats()\nawait tools.growl({ amount: Math.ceil(s.attack / 4) })') })
  assert.equal(g.outcome, 'crit')
  const gw = await scoreCompletion({ move: 'GROWL', seed: 3, completion: block('const s = await tools.stats()\nawait tools.growl({ amount: Math.floor(s.attack / 4) + 100 })') })
  assert.equal(gw.outcome, 'miss')
  const w = await scoreCompletion({ move: 'TAIL WHIP', seed: 3, completion: block('const s = await tools.stats()\nawait tools.tail_whip({ amount: Math.floor(s.defense / 4) })') })
  assert.equal(w.outcome, 'crit')
})

test('prompt: Pokémon voice, declarations, no prose instruction', () => {
  const p = promptFor('SCRATCH', { foe: makeFoe(2) })
  assert.match(p.system, /You are CHARMANDER, a level 5 Pokémon/)
  assert.match(p.system, /scratch\(args: \{/)
  assert.match(p.user, /use SCRATCH!/)
})
