// node --test rules/test/
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EMIT, OPS, OP_NAMES, parseRunes, runTape, glyphs, toJavaScript, runePrompt, judgeRunes, usesRunes, byName, rng } from '../index.mjs'

const judged = (name, text, key, budget = 60) => judgeRunes({ move: byName[name], text, key, budget })

test('runes: every op has a glyph, a JavaScript meaning and an arity', () => {
  for (const [name, op] of Object.entries(OPS)) {
    assert.ok(op.glyph && op.glyph.length <= 2, name)
    assert.equal(typeof op.js, 'function', name)
    assert.ok(Number.isInteger(op.args), name)
  }
  assert.equal(new Set(Object.values(OPS).map(o => o.glyph)).size, OP_NAMES.length, 'glyphs are unique')
})

test('runes: parse accepts lines, pipes, fences and comments; rejects bad ops and arity', () => {
  assert.deepEqual(parseRunes('put 1 2 | count').ops, [{ op: 'put', args: [1, 2] }, { op: 'count', args: [] }])
  assert.deepEqual(parseRunes('```\nraw ff 10 // bytes\nchecksum\n```').ops, [{ op: 'raw', args: [255, 16] }, { op: 'checksum', args: [] }])
  assert.deepEqual(parseRunes('put 1\nfilter > 0').ops[1], { op: 'filter', args: ['>', 0] })
  assert.match(parseRunes('').error, /no program/)
  assert.match(parseRunes('return 4').error, /unknown op/)
  assert.match(parseRunes('count 3').error, /takes 0/)
  assert.match(parseRunes('write 1').error, /takes 2/)
  assert.match(parseRunes('put').error, /needs numbers/)
  assert.match(parseRunes('put x').error, /needs numbers/)
  assert.match(parseRunes('loop 2\nput 1').error, /loop without end/)
  assert.match(parseRunes('end').error, /end without loop/)
})

test('runes: run — tape ops, loops, and the errors the game calls a crash', () => {
  const run = text => runTape(parseRunes(text).ops)
  assert.deepEqual(run('put 4\nput 42 13 140 77').tape, [4, 42, 13, 140, 77])
  assert.deepEqual(run('put 1 1 1 1\nset 230').tape, [230, 230, 230, 230])
  assert.deepEqual(run('raw ff 0a 7e 10\nchecksum').tape, [255, 10, 126, 16, (255 + 10 + 126 + 16) % 256])
  assert.deepEqual(run('put 5 12 8\nspike 200').tape, [5, 12, 8, 200])
  assert.deepEqual(run('loop 3\nput 7\nend\ncount').tape, [7, 7, 7, 3])
  assert.deepEqual(run('put 300').tape, [44], 'bytes wrap')
  assert.deepEqual(run('put 3 1 2\nsort\nrev').tape, [3, 2, 1])
  assert.deepEqual(run('put 1 2 3\nfilter > 1\nsum').tape, [2, 3, 5])
  assert.match(run('stream 9 3').error, /must rise/)
  assert.match(run('put 250\nspike 200').error, /must be the largest/)
  assert.match(run('write 0 1').error, /nothing at index/)
  assert.match(run('peak').error, /empty tape/)
  assert.match(run('put 1\nloop 255\ndup\nend').error, /tape is full/)
  assert.match(run('loop 255\nloop 255\nloop 255\ncount\nend\nend\nend').error, /never ends|tape is full/)
})

test('runes: glyphs hide the words, the decoder shows JavaScript that computes the same tape', () => {
  const { ops } = parseRunes('raw ff 0a 7e 10\nchecksum')
  const strip = glyphs(ops)
  assert.doesNotMatch(strip, /raw|checksum/)
  assert.match(strip, /ff 0a 7e 10/)
  const js = toJavaScript(ops)
  assert.match(js, /^let t = \[\]/)
  assert.deepEqual(new Function(js)(), runTape(ops).tape)
  for (const spec of Object.values(EMIT)) {
    const parsed = parseRunes(spec.example.program)
    assert.deepEqual(new Function(toJavaScript(parsed.ops))(), runTape(parsed.ops).tape, spec.example.program)
  }
})

test('runes: the five emitters — each example hits its own key, misses another, and is a FireRed move of that type', () => {
  for (const [name, spec] of Object.entries(EMIT)) {
    const move = byName[name]
    assert.ok(move, name)
    assert.equal(move.type, spec.type, name)
    assert.ok(usesRunes(move), name)
    assert.equal(judged(name, spec.example.program, spec.example.key).hit, true, name)
    const other = spec.example.key === 255 ? 254 : spec.example.key + 1
    const miss = judged(name, spec.example.program, other)
    assert.equal(miss.hit, false, name)
    assert.equal(miss.reason, 'wrong answer', name)
    const r = rng(7)
    for (let i = 0; i < 20; i++) { const k = spec.key(r); assert.ok(Number.isInteger(k) && k >= 0 && k <= 255, name); assert.ok(spec.want(k).includes(String(k)), name) }
  }
  assert.equal(usesRunes(byName.SLICE), false)
  assert.equal(usesRunes(undefined), false)
})

test('runes: the judge names the four reasons the ROM prints', () => {
  assert.deepEqual(judged('PING', '', 77), { hit: false, reason: 'no code' })
  assert.equal(judged('PING', 'put 4\nput 42 13 140 77', 77, 10).reason, 'over budget')
  assert.equal(judged('PING', 'return 4', 77).reason, 'crashed')
  assert.equal(judged('FLUSH', 'stream 9 3 40', 40).reason, 'crashed')
  assert.equal(judged('FLUSH', 'stream 3 9 41 88', 40).reason, 'wrong answer')
  assert.equal(judged('SLICE', 'put 1', 1).reason, 'no code')
  assert.deepEqual(judged('BURNDISC', '```\nput 1 1 1 1\nset 230\n```', 230).got, [230, 230, 230, 230])
})

test('runes: the prompt carries the move, the key, the example and no foe data', () => {
  const p = runePrompt({ self: { name: 'SQUIRTLE', level: 5 }, target: { name: 'PIDGEY', level: 3 }, move: byName.FLUSH, key: 40, budget: 30, hot: 'short lines' })
  assert.match(p.system, /SQUIRTLE, a level 5/)
  assert.match(p.system, /exactly 1 line,/)
  assert.match(p.user, /FLUSH \(Water\)/)
  assert.match(p.user, /one of them 40/)
  assert.match(p.user, /Ops: stream n… \(append numbers, each greater than the last\)\./, 'only the move\'s own ops')
  assert.doesNotMatch(p.user, /checksum|spike/)
  assert.match(p.user, /stream 3 9 40 88/)
  assert.match(p.user, /short lines/)
  assert.match(p.user, /PIDGEY, level 3/)
  assert.doesNotMatch(p.user, /data|bytes of the foe/i)
  const full = runePrompt({ self: { name: 'SQUIRTLE', level: 5 }, target: { name: 'PIDGEY', level: 3 }, move: byName.FLUSH, key: 40, budget: 30, style: 'full' })
  assert.match(full.system, /checksum/); assert.match(full.user, /At most 30 characters/)
  for (const spec of Object.values(EMIT)) for (const op of spec.ops) assert.ok(OPS[op], op)
})
