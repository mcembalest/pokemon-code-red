import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extractCode, normalizeBlock, promptFor, scoreCompletion } from '../evaluate.mjs'
import { makeFoe } from '../contracts.mjs'

const block = code => '```js\n' + code + '\n```'

test('format: exactly one code block, no prose', () => {
  assert.equal(extractCode(block('return 1')).code, 'return 1')
  assert.equal(extractCode('```javascript\nreturn 1\n```').code, 'return 1')
  assert.match(extractCode('Sure! ' + block('return 1')).reason, /prose/)
  assert.equal(extractCode('return 1').code, 'return 1')  // unfenced = code
  assert.match(extractCode(block('a') + '\n' + block('b')).reason, /more than one|prose/)
})

test('SCRATCH: correct → hit/crit; wrong slots → miss; crash → miss; over budget → miss', async () => {
  const good = `const f = await tools.scan()\nconst s = f.bytes.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]).slice(0, 3)\nfor (const [, i] of s) await tools.scratch({ slot: i })`
  const r = await scoreCompletion({ move: 'SCRATCH', seed: 7, completion: block(good) })
  assert.equal(r.outcome, 'crit', JSON.stringify(r))
  const verbose = `// fire fire fire\n// let me think about the bytes very carefully here before scratching anything at all\nconst f = await tools.scan()\nconst s = f.bytes.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]).slice(0, 3)\nfor (const [, i] of s) await tools.scratch({ slot: i })`
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

test('uncalled single function gets called; called or multiple left alone', async () => {
  assert.match(normalizeBlock('async function growl() { return 1 }'), /return await growl\(\)$/)
  assert.equal(normalizeBlock('async function a() {}\nawait a()'), 'async function a() {}\nawait a()')
  assert.equal(normalizeBlock('function a() {}\nfunction b() {}'), 'function a() {}\nfunction b() {}')
  const r = await scoreCompletion({ move: 'GROWL', seed: 3, completion: '```js\nasync function growl() {\n  const s = await tools.stats({})\n  await tools.growl({ amount: Math.ceil(s.attack / 4) })\n}\n```' })
  assert.equal(r.outcome, 'crit', JSON.stringify(r))
  const prose = await scoreCompletion({ move: 'GROWL', seed: 3, completion: 'I will growl at the foe now.' })
  assert.equal(prose.outcome, 'miss')
})

test('situational rules: correct branching code hits; naive code misses where the situation differs', async () => {
  const { makeFoe } = await import('../contracts.mjs')
  const smart = {
    SCRATCH: "const f = await tools.scan({})\nconst k = f.status === 'asleep' ? 2 : 3\nconst c = f.bytes.map((v, i) => [v, i]).filter(([, i]) => !f.guarded.includes(i)).sort((a, b) => a[0] - b[0]).slice(0, k)\nfor (const [, i] of c) await tools.scratch({ slot: i })",
    TACKLE: "const f = await tools.scan({})\nlet s = f.bytes.reduce((a, b) => a + b, 0)\nif (f.type === 'ROCK') s -= Math.max(...f.bytes)\nif (f.status === 'paralyzed') s *= 2\nawait tools.tackle({ force: s })",
    GROWL: "const s = await tools.stats({})\nawait tools.growl({ amount: s.status === 'asleep' ? 0 : Math.ceil(s.attack / (s.type === 'FIRE' ? 2 : 4)) })",
    'TAIL WHIP': "const s = await tools.stats({})\nawait tools.tail_whip({ amount: Math.floor(s.defense / 4) + s.guarded + (s.status === 'poisoned' ? 2 : 0) })",
  }
  const naive = "const { bytes } = await tools.scan({})\nawait tools.tackle({ force: bytes.reduce((a, b) => a + b, 0) })"
  let naiveMiss = 0
  for (let seed = 0; seed < 40; seed++) {
    for (const [move, code] of Object.entries(smart)) {
      const r = await scoreCompletion({ move, seed, completion: '```js\n' + code + '\n```', situational: true })
      assert.notEqual(r.outcome, 'miss', `${move} seed ${seed} ${JSON.stringify(makeFoe(seed))} ${r.reason}`)
    }
    const n = await scoreCompletion({ move: 'TACKLE', seed, completion: '```js\n' + naive + '\n```', situational: true })
    if (n.outcome === 'miss') naiveMiss++
  }
  assert.ok(naiveMiss > 5 && naiveMiss < 35, `naive TACKLE should miss only in some situations, missed ${naiveMiss}/40`)
})
