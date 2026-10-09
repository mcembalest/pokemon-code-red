// node --test rules/test/
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  BADGES, FORMATS, HINTS, MOVES, budgetAt, byFireRed, byName, focusAt, judge, knowFor, learn, learnFromHit, missText,
  partyDex, readerLine, rng, same, slotsAt, targetBytes, turnData, turnPrompt, turnType,
} from '../index.mjs'

// Node-only stand-in for the sandbox (the game uses the QuickJS runner, the lab uses kernel runBlock).
const runSource = async source => { try { return { ok: true, value: new Function(source)() } } catch (e) { return { ok: false, error: String(e) } } }
const TYPES = Object.keys(FORMATS)

test('rules are browser-safe: no node: imports', () => {
  const dir = new URL('../', import.meta.url)
  for (const f of readdirSync(dir).filter(f => f.endsWith('.mjs'))) assert.doesNotMatch(readFileSync(new URL(f, dir), 'utf8'), /from ['"]node:/, f)
})

test('moves: 103, unique function names, answers never null, FireRed stats attached', () => {
  assert.equal(MOVES.length, 103)
  assert.equal(new Set(MOVES.map(m => m.fn)).size, MOVES.length)
  const r = rng(1)
  for (let k = 0; k < 50; k++) {
    const b = targetBytes(r)
    for (const m of MOVES) assert.notEqual(m.ref(b), null, m.name)
  }
  for (const m of MOVES) assert.ok(m.type && m.power && m.acc && m.effect, m.firered)
  assert.equal(byName.SLICE.firered, 'Scratch')
})

test('moves: found by the ROM spelling of FireRed names', () => {
  assert.equal(byFireRed('SCRATCH').name, 'SLICE')
  assert.equal(byFireRed('SAND-ATTACK').name, 'SANDBOX')
  assert.equal(byFireRed('DOUBLESLAP').name, 'UNDO')
  assert.equal(byFireRed('THUNDERSHOCK').name, 'SURGE')
  assert.equal(byFireRed('SELFDESTRUCT').name, 'RM -RF')
  assert.equal(byFireRed('HYPER BEAM'), undefined)
})

test('formats: every type round-trips, and its Pokédex reader reads it', async () => {
  const r = rng(7)
  for (let k = 0; k < 20; k++) {
    const b = targetBytes(r)
    for (const t of TYPES) {
      const data = FORMATS[t].encode(b)
      assert.deepEqual(FORMATS[t].decode(data), b, t)
      const run = await runSource(`const data = ${JSON.stringify(data)}\n${HINTS[t]}\nreturn nums`)
      assert.deepEqual(run.value, b, `${t} reader`)
    }
  }
})

test('target bytes: 4–7 different numbers, 10..199; dual types pick either format', () => {
  const r = rng(3)
  for (let k = 0; k < 200; k++) {
    const b = targetBytes(r)
    assert.ok(b.length >= 4 && b.length <= 7 && new Set(b).size === b.length && b.every(x => x >= 10 && x <= 199))
  }
  const picks = new Set(Array.from({ length: 50 }, () => turnType(r, ['ROCK', 'GROUND'])))
  assert.deepEqual([...picks].sort(), ['GROUND', 'ROCK'])
})

test('prompt: the calibrated journey text', () => {
  const p = turnPrompt({ self: { name: 'CHARMANDER', level: 5 }, target: { name: 'SQUIRTLE', level: 5, types: ['WATER'] }, move: byName.SLICE, type: 'WATER', budget: 250 })
  assert.equal(p.system, "You are CHARMANDER, a level 5 Pokémon. You fight by writing JavaScript.\nWhen your trainer calls a move, you write the code for it, then stop.\nReply with only one JavaScript code block. No words outside it. Comments inside are fine.")
  assert.equal(p.user, [
    'Foe: SQUIRTLE Lv5 (WATER). Your trainer says: use SLICE!',
    'Write the function: function slice(data)',
    '- data = the foe\'s numbers, this turn in WATER format: text with one number per line (a stream). Example: "42\\n13\\n140" is [42, 13, 140].',
    '- First line of the function: const nums = <read data into a list of numbers>',
    '- slice returns the first 3 numbers (a list). On the numbers [42,13,140,77] it returns [42,13,140].',
    '- Byte budget: your whole code block must be at most 250 characters, comments included.',
  ].join('\n'))
  const dex = turnPrompt({ self: { name: 'PIDGEY', level: 3, wild: true }, target: { name: 'CHARMANDER', level: 5, types: ['FIRE'] }, move: byName.PING, type: 'FIRE', know: knowFor('FIRE', { dex: ['FIRE'] }), budget: 230 })
  assert.match(dex.user, /You use PING!/)
  assert.match(dex.user, /- Pokédex: FIRE data reads like this: const nums = \[\.\.\.data\]\.sort/)
  assert.match(dex.system, /When you pick a move/)
  const mem = turnPrompt({ self: { name: 'CHARMANDER', level: 9 }, target: { name: 'PIKACHU', level: 5, types: ['ELECTRIC'] }, move: byName.BURNDISC, type: 'ELECTRIC', know: knowFor('ELECTRIC', { readers: { ELECTRIC: 'const nums = x' } }), budget: 290 })
  assert.match(mem.user, /- You remember how you read ELECTRIC data: const nums = x/)
  const tut = turnPrompt({ self: { name: 'CHARMANDER', level: 5 }, target: { name: 'SQUIRTLE', level: 5, types: ['WATER'] }, move: byName.SLICE, type: 'WATER', budget: 250, tutorial: true })
  assert.match(tut.user, /- data = the foe's numbers, already a plain list of numbers\. Example: \[42, 13, 140\]\./)
  assert.doesNotMatch(tut.user, /format|First line/)
})

test('knowing: the Pokédex comes before memory', () => {
  assert.equal(knowFor('ROCK', {}), null)
  assert.equal(knowFor('ROCK', { readers: { ROCK: 'mine' } }).from, 'memory')
  assert.deepEqual(knowFor('ROCK', { dex: ['ROCK'], readers: { ROCK: 'mine' } }), { from: 'dex', line: HINTS.ROCK })
})

test('judging: right answer hits; wrong, crash, too long and no code miss', async () => {
  const bytes = [42, 13, 140, 77], data = turnData(bytes, 'GROUND'), move = byName.SLICE, budget = 250
  const good = "function slice(data) {\n  const nums = data.split(',').map(Number)\n  return nums.slice(0, 3)\n}"
  assert.deepEqual(await judge({ move, bytes, data, code: good, budget, runSource }), { hit: true })
  const body = "const nums = data.split(',').map(Number)\nreturn nums.slice(0, 3)"
  assert.equal((await judge({ move, bytes, data, code: body, budget, runSource })).hit, true, 'a bare function body counts')
  const camel = good.replace('function slice', 'function Slice')
  assert.equal((await judge({ move, bytes, data, code: camel, budget, runSource })).hit, true, 'same name in another case')
  const wrong = await judge({ move, bytes, data, code: 'function slice(data) { return data.slice(0, 3) }', budget, runSource })
  assert.equal(wrong.reason, 'wrong answer')
  assert.equal((await judge({ move, bytes, data, code: 'function slice(data) { return data.nope() }', budget, runSource })).reason, 'crashed')
  assert.equal((await judge({ move, bytes, data, code: good, budget: 20, runSource })).reason, 'over budget')
  assert.equal((await judge({ move, bytes, data, code: null, budget, runSource })).reason, 'no code')
  assert.equal(missText('CHARMANDER', 'crashed'), "CHARMANDER's code crashed!")
  assert.equal(turnData(bytes, 'GROUND', true).join(), bytes.join(), 'tutorial sends the plain list')
})

test('learning: only verified readers; most recent kept within slots; Pokédex types not memorized', async () => {
  const bytes = [42, 13, 140, 77], data = turnData(bytes, 'ROCK')
  const right = "function slice(data) {\n  const nums = data.split(' ').map(h => parseInt(h, 16))\n  return nums.slice(0, 3)\n}"
  assert.equal(readerLine(right), "const nums = data.split(' ').map(h => parseInt(h, 16))")
  let readers = await learnFromHit({ readers: {}, type: 'ROCK', code: right, data, bytes, slots: 2, runSource })
  assert.deepEqual(Object.keys(readers), ['ROCK'])
  const lucky = "function hash(data) { const nums = data.split(' ').map(Number); return 0 }"
  assert.deepEqual(await learnFromHit({ readers: {}, type: 'ROCK', code: lucky, data, bytes, slots: 2, runSource }), {}, 'a lucky hit teaches nothing')
  assert.deepEqual(await learnFromHit({ readers: {}, type: 'ROCK', code: right, data, bytes, slots: 2, dex: ['ROCK'], runSource }), {})
  readers = learn(readers, 'WATER', 'w', 2)
  readers = learn(readers, 'GRASS', 'g', 2)
  assert.deepEqual(Object.keys(readers), ['WATER', 'GRASS'], 'oldest forgotten')
  readers = learn(readers, 'WATER', 'w2', 2)
  assert.deepEqual(readers, { GRASS: 'g', WATER: 'w2' }, 'refresh moves it to the end')
})

test('growth: focus calms, budget and slots grow, evolution jumps, badges teach', () => {
  assert.equal(focusAt(5), 0.8)
  assert.ok(Math.abs(focusAt(15) - 0.5) < 1e-9)
  assert.equal(focusAt(40), 0.3)
  assert.equal(budgetAt(5), 350)
  assert.equal(budgetAt(16, { stage: 1 }), 560)
  assert.equal(budgetAt(16, { stage: 1, badges: ['BOULDER', 'CASCADE'] }), 610)
  assert.equal(slotsAt(5), 2)
  assert.equal(slotsAt(14), 5)
  assert.equal(slotsAt(16, { stage: 1 }), 8)
  assert.deepEqual(partyDex({ seen: ['WATER'], badges: ['BOULDER'] }).sort(), ['GROUND', 'ROCK', 'WATER'])
  assert.deepEqual(BADGES.CASCADE, { budget: 50 })
})

test('same: JSON-like deep equality', () => {
  assert.ok(same([1, [2, 'a']], [1, [2, 'a']]))
  assert.ok(!same([1, 2], [1, '2']))
  assert.ok(same(undefined, undefined))
  assert.ok(!same([], {}))
  assert.ok(same({ a: 1 }, { a: 1 }))
})

test('status moves hit the code: notches shake or steady focus and budget, capped at ±2', async () => {
  const { NOTCH, notchOf } = await import('../index.mjs')
  assert.equal(notchOf(0), 0); assert.equal(notchOf(-1), -1); assert.equal(notchOf(-5), -2); assert.equal(notchOf(3), 2)
  assert.ok(Math.abs(focusAt(5, undefined, -2) - 1.0) < 1e-9, 'two notches down: +0.2 temperature')
  assert.ok(Math.abs(focusAt(5, undefined, 2) - 0.6) < 1e-9)
  assert.equal(budgetAt(5, { notch: -2 }), 280); assert.equal(budgetAt(5, { notch: 1 }), 385)
  assert.equal(NOTCH.cap, 2)
})

test('knowledge tiers: wild none, trainers about half (fixed per Pokémon), bosses all; the token cap follows the budget', async () => {
  const { KNOWLEDGE, foeDex, tierOf, tokenCapFor } = await import('../index.mjs')
  const formats = Object.keys(FORMATS)
  assert.deepEqual(foeDex('wild', 123, formats), [])
  assert.deepEqual(foeDex('boss', 123, formats), formats)
  assert.equal(tierOf(84, false), 'boss'); assert.equal(tierOf(81, false), 'boss'); assert.equal(tierOf(2, false), 'trainer'); assert.equal(tierOf(0, true), 'wild')
  const a = foeDex('trainer', 1234567, formats), b = foeDex('trainer', 1234567, formats)
  assert.deepEqual(a, b, 'the same Pokémon reads the same formats all battle')
  const share = Array.from({ length: 200 }, (_, i) => foeDex('trainer', i * 7919 + 13, formats).length / formats.length).reduce((x, y) => x + y, 0) / 200
  assert.ok(Math.abs(share - KNOWLEDGE.trainer) < 0.08, `about half: ${share}`)
  assert.equal(tokenCapFor(350), 260)
})
