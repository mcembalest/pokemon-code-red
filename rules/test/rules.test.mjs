// node --test rules/test/
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  BADGES, FORMATS, HINTS, MOVES, budgetAt, byFireRed, byName, focusAt, judge, knowFor, missText,
  rng, same, targetBytes, turnData, turnPrompt, turnType, verdict, instinct, doubtChance, maxDoubt, typeChart,
} from '../index.mjs'

// Node-only stand-in for the sandbox (the game uses the QuickJS runner, the lab uses kernel runBlock).
const runSource = async source => { try { return { ok: true, value: new Function(source)() } } catch (e) { return { ok: false, error: String(e) } } }
const TYPES = Object.keys(FORMATS)

test('rules are browser-safe: no node: imports', () => {
  const dir = new URL('../', import.meta.url)
  for (const f of readdirSync(dir).filter(f => f.endsWith('.mjs'))) assert.doesNotMatch(readFileSync(new URL(f, dir), 'utf8'), /from ['"]node:/, f)
})

test('moves: 212, unique function names, answers never null, FireRed stats attached', () => {
  assert.equal(MOVES.length, 212)
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
  assert.equal(byFireRed('SELFDESTRUCT').name, 'WIPE')
  assert.equal(byFireRed('HYPER BEAM').name, 'LASER')
  assert.equal(byFireRed('WILL-O-WISP').name, 'FLICKER')
  assert.equal(byFireRed('FLY'), undefined)
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

test('growth: focus calms, budget grows, evolution jumps', () => {
  assert.equal(focusAt(5), 0.8)
  assert.ok(Math.abs(focusAt(15) - 0.5) < 1e-9)
  assert.equal(focusAt(40), 0.3)
  assert.equal(budgetAt(5), 350)
  assert.equal(budgetAt(16, { stage: 1 }), 560)
  assert.equal(budgetAt(16, { stage: 1, badges: ['BOULDER', 'CASCADE'] }), 640)
  assert.deepEqual(BADGES.BOULDER, { budget: 30 }, 'badges teach no readers since 2026-10-11: bytes instead')
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

test('one context budget: the reader and hot memory are charged against the budget', async () => {
  const { codeBudget, contextCost, tokenCapFor } = await import('../index.mjs')
  const know = knowFor('ROCK', { dex: ['ROCK'] })
  assert.equal(contextCost({ know, hot: 'be brief' }), HINTS.ROCK.length + 8)
  assert.equal(codeBudget(350, { know, hot: 'be brief' }), 350 - HINTS.ROCK.length - 8)
  const p = turnPrompt({ self: { name: 'A', level: 5 }, target: { name: 'B', level: 5, types: ['ROCK'] }, move: byName.SLICE, type: 'ROCK', know, budget: 350, hot: 'be brief' })
  assert.match(p.user, /- Your notes: be brief/)
  assert.match(p.user, new RegExp(`at most ${350 - HINTS.ROCK.length - 8} characters, comments included \\(350 minus the ${HINTS.ROCK.length + 8} your memory takes\\)`))
  assert.equal(tokenCapFor(350), 260, 'the token cap follows the budget')
})

test('payload moves: the checker judges the character, a hit carries the bytes, the prompt says how (they read nothing)', async () => {
  const error = byName.ERROR, flash = byName.FLASH, spark = byName.SPARK
  const bytes = [42, 13, 140, 77]
  const run = v => ({ ok: true, value: v })
  for (const m of ['ERROR', 'BUZZ', 'FEEDBACK', 'DIM', 'FLASH', 'SPARK']) assert.equal(verdict(byName[m], bytes, run(byName[m].ref(bytes))).hit, true, m)
  const hit = verdict(error, bytes, run(error.ref(bytes)))
  assert.equal(hit.payload.kind, 'sound'); assert.equal(hit.payload.bytes.length, 3199)
  const tone = Array.from({ length: 3199 }, (_, i) => (Math.floor(i / 10) % 2 ? 30 : 230))
  assert.match(verdict(error, bytes, run(tone)).want, /fades/) // a flat tone is not a growl
  const rising = Array.from({ length: 3199 }, (_, i) => { const t = i / 3200; return 128 + (1 - t) * 90 * Math.sign(Math.sin(i * (0.1 + 0.3 * t))) })
  assert.match(verdict(error, bytes, run(rising)).want, /slide down/)
  assert.match(verdict(error, bytes, run([230, 30])).want, /at least 1000/)
  const pic = verdict(flash, bytes, run(flash.ref(bytes)))
  assert.equal(pic.payload.kind, 'image'); assert.equal(pic.payload.bytes.length, 4096); assert.equal(pic.payload.bytes[0], 0) // a see-through corner
  const square = Array.from({ length: 4096 }, (_, i) => { const k = i % 1024; return (k & 31) > 8 && (k & 31) < 24 && k >> 5 > 8 && k >> 5 < 24 ? 15 : 0 })
  assert.match(verdict(flash, bytes, run(square)).want, /3 different colors/)
  assert.match(verdict(flash, bytes, run(new Array(4096).fill(300))).want, /see-through/) // 300 sticks to 15: a filled square
  assert.equal(verdict(error, bytes, run(error.ref(bytes).map(x => x + 0.4))).hit, true) // fractions round
  const blob = Array.from({ length: 4096 }, (_, i) => { const f = i >> 10, k = i % 1024, r = Math.hypot((k & 31) - 15.5, (k >> 5) - 15.5); return r < 5 + f ? Math.max(1, 15 - Math.round(r)) : 0 })
  assert.equal(verdict(flash, bytes, run(blob)).hit, true) // a glowing ball that grows is a flash…
  assert.match(verdict(spark, bytes, run(blob)).want, /top rows/) // …not a bolt
  // voices (2026-10-13): one cycle of a wave, the instrument the move's own FireRed sound effects play with
  const dim = byName.DIM, feedback = byName.FEEDBACK, buzz = byName.BUZZ
  const voice = verdict(dim, bytes, run(dim.ref(bytes)))
  assert.equal(voice.payload.kind, 'voice'); assert.equal(voice.payload.bytes.length, 64)
  const sine = Array.from({ length: 64 }, (_, i) => 128 + 70 * Math.sin((2 * Math.PI * i) / 64))
  const pulse = Array.from({ length: 64 }, (_, i) => (i < 8 ? 230 : 113))
  const grit = Array.from({ length: 64 }, (_, i) => 128 + 60 * Math.sin((2 * Math.PI * i * 9) / 64))
  assert.equal(verdict(dim, bytes, run(sine)).hit, true)
  assert.match(verdict(dim, bytes, run(pulse)).want, /smooth and round/)
  assert.equal(verdict(feedback, bytes, run(pulse)).hit, true)
  assert.match(verdict(feedback, bytes, run(sine)).want, /thin pulse/)
  assert.equal(verdict(buzz, bytes, run(grit)).hit, true)
  assert.match(verdict(buzz, bytes, run(sine)).want, /gritty/)
  assert.match(verdict(dim, bytes, run(sine.map(x => x + 60))).want, /around 128/)
  assert.match(verdict(dim, bytes, run(sine.map(x => 128 + (x - 128) / 4))).want, /too quiet/)
  assert.match(verdict(dim, bytes, run(new Array(300).fill(128))).want, /at most 256/)
  assert.match(verdict(dim, bytes, run([1, 2, 3])).want, /at least 16/)
  assert.match(turnPrompt({ self: { name: 'A', level: 5 }, target: { name: 'B', level: 5, types: ['NORMAL'] }, move: dim, type: 'NORMAL', budget: 300 }).user, /one cycle of a wave/)
  const { user } = turnPrompt({ self: { name: 'A', level: 5 }, target: { name: 'B', level: 5, types: ['NORMAL'] }, move: error, type: 'NORMAL', budget: 300 })
  assert.match(user, /phase p/); assert.match(user, /make it your own/); assert.match(user, /function error\(\)\{const o=\[\]/)
  assert.doesNotMatch(user, /data = the foe/) // a payload move reads nothing
  assert.ok(user.length < 1800, String(user.length))
  // every species has its own voice: the example in the prompt differs, the character doesn't
  const pid = turnPrompt({ self: { name: 'PIDGEY', level: 5 }, target: { name: 'B', level: 5, types: ['NORMAL'] }, move: error, type: 'NORMAL', budget: 300 }).user
  assert.notEqual(pid, user.replace(/\bA\b/g, 'PIDGEY')); assert.match(pid, /PIDGEY's own voice/)
})

test('doubt: the chance it uses its own pick is ½ × how much worse your call is × (1 − friendship / 255)', () => {
  const slice = { id: 10, name: 'SLICE', power: 40, accuracy: 100, type: 'NORMAL' }
  const ember = { id: 52, name: 'EMBER', power: 40, accuracy: 100, type: 'FIRE' }
  const error = { id: 45, name: 'ERROR', power: 0, accuracy: 100, type: 'NORMAL' }
  const moves = [slice, error, ember]
  const vsGrass = t => (t === 'FIRE' ? 2 : 1)
  const ctx = { moves, selfTypes: ['FIRE'], effectiveness: vsGrass }
  // Charmander vs a Grass foe: Ember (40 × 2 × 1.5 STAB = 120) is its instinct; Slice scores 40.
  assert.equal(instinct(moves, ctx), ember)
  const d = doubtChance({ ...ctx, chosen: slice, friendship: 0 })
  assert.ok(Math.abs(d.chance - 1 / 3) < 1e-9); assert.equal(d.wanted, ember) // ½ × (1 − 40/120)
  assert.equal(doubtChance({ ...ctx, chosen: error, friendship: 0 }).chance, 0.5) // a status move: the cap
  assert.deepEqual(doubtChance({ ...ctx, chosen: ember, friendship: 70 }), { chance: 0, wanted: null })
  // friendship: a starter's 70 → about 36%; halfway halves it; 255 ends it (badges no longer count)
  assert.ok(Math.abs(doubtChance({ ...ctx, chosen: error, friendship: 70 }).chance - 0.5 * 185 / 255) < 1e-9)
  assert.ok(Math.abs(doubtChance({ ...ctx, chosen: error, friendship: 127.5 }).chance - 0.25) < 1e-9)
  assert.equal(doubtChance({ ...ctx, chosen: error, friendship: 255 }).chance, 0)
  assert.equal(maxDoubt(0), 0.5); assert.equal(Math.round(maxDoubt(70) * 100), 36); assert.equal(maxDoubt(300), 0)
  // only status moves: nothing to disagree with
  assert.deepEqual(doubtChance({ chosen: error, moves: [error] }), { chance: 0, wanted: null })
  // the type chart reader
  const rom = new Uint8Array([10, 12, 20, 0xFE, 0xFE, 0, 11, 10, 5, 0xFF])
  const eff = typeChart(rom, 0)
  assert.equal(eff(10, [12, 12]), 2); assert.equal(eff(11, [10, 3]), 0.5); assert.equal(eff(0, [1]), 1)
})

test('memory is code: my… helpers are found at any depth, skipping strings and comments; fitting drops the oldest', async () => {
  const { extractHelpers, mergeHelpers, fitHelpers, helpersSize, libCap } = await import('../memory.mjs')
  const code = "// function myNot() {}\nfunction myRead(data) { return data.split('}').map(Number) }\nconst myMax = xs =>\n  Math.max(...xs)\nfunction slice(data) {\n  let myTmp = { a: '{' }\n  return 1\n}"
  const h = extractHelpers(code)
  assert.deepEqual(h.map(x => x.name), ['myRead', 'myMax', 'myTmp'])
  assert.equal(h[1].src, 'const myMax = xs =>\n  Math.max(...xs);')
  assert.equal(h[2].src, "const myTmp = { a: '{' };")
  const merged = mergeHelpers(h, [{ name: 'myRead', src: 'const myRead = d => d;' }])
  assert.deepEqual(merged.map(x => x.name), ['myMax', 'myTmp', 'myRead'])
  const fit = fitHelpers(merged, 50)
  assert.ok(helpersSize(fit) <= 50 && fit.at(-1).name === 'myRead')
  assert.equal(libCap(5), 105); assert.equal(libCap(40), 280)
})

test('memory: re-writing a carried helper costs nothing; consolidation sees how each helper did', async () => {
  const { withoutCarried, consolidatePrompt } = await import('../memory.mjs')
  const carried = [{ name: 'myReadPoison', src: "function myReadPoison(d){return d.split('x').filter(Boolean).map(Number)}" }]
  assert.equal(withoutCarried("function myReadPoison(d) { return d.split('x').filter(Boolean).map(Number) }\nfunction ping(data){return myReadPoison(data).length}", carried), 'function ping(data){return myReadPoison(data).length}')
  assert.match(withoutCarried('function myReadPoison(d){return 1}\nfunction ping(d){}', carried), /return 1/, 'a changed helper is new code')
  const p = consolidatePrompt({ self: { name: 'BULBASAUR', level: 7 }, lib: [], work: carried, cap: 115, stats: { myReadPoison: { used: 6, hits: 5 } } })
  assert.match(p.user, /\/\/ myReadPoison: used 6×, 5 hits\nfunction myReadPoison/)
  assert.match(p.user, /at most 115 characters/)
})

test('memory: a reading helper is kept only if it reads its format right', async () => {
  const { checkSource, readerType } = await import('../memory.mjs')
  const { runBlock } = await import('../../kernel/code.mjs')
  assert.equal(readerType('myReadPoison'), 'POISON'); assert.equal(readerType('myMax'), null); assert.equal(readerType('myReadNormal'), null)
  const helpers = [
    { name: 'myReadPoison', src: "function myReadPoison(d){return d.split('x').filter(Boolean).map(Number)}" },
    { name: 'myReadBug', src: "function myReadBug(d){return d.split(' ').map(Number)}" }, // wrong: BUG data is a list
    { name: 'myMax', src: 'const myMax = xs => Math.max(...xs);' },
  ]
  const r = await runBlock(checkSource(helpers, { type: 'POISON', data: 'x10x20x', bytes: [10, 20] }), [])
  assert.deepEqual(r.value, { myReadPoison: true, myReadBug: false, myMax: true })
  const wrongToday = await runBlock(checkSource(helpers.slice(0, 1), { type: 'POISON', data: 'x10x20x', bytes: [10, 21] }), [])
  assert.deepEqual(wrongToday.value, { myReadPoison: false })
})

test('memory: it recalls the reader for this turn’s format and its other helpers; a reader must name its format', async () => {
  const { recall, memoryLines, checkSource } = await import('../memory.mjs')
  const { runBlock } = await import('../../kernel/code.mjs')
  const hs = [{ name: 'myReadPoison', src: 'function myReadPoison(d){return d}' }, { name: 'myReadBug', src: 'function myReadBug(d){return d}' }, { name: 'myMax', src: 'const myMax = 1;' }]
  assert.deepEqual(recall(hs, 'BUG').map(h => h.name), ['myReadBug', 'myMax'])
  assert.doesNotMatch(memoryLines({ lib: hs, type: 'BUG' }).join('\n'), /myReadPoison/)
  const r = await runBlock(checkSource([{ name: 'myReadData', src: 'function myReadData(d){return d}' }]), [])
  assert.deepEqual(r.value, { myReadData: false })
})

test("FireRed's six-letter type names map to their formats", async () => {
  const { formatOf } = await import('../turn.mjs')
  assert.equal(formatOf('ELECTR'), 'ELECTRIC'); assert.equal(formatOf('PSYCHC'), 'PSYCHIC'); assert.equal(formatOf('FIRE'), 'FIRE'); assert.equal(formatOf('???'), 'NORMAL')
})
