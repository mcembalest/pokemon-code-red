import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GbaMemory, fakeCore } from '../bridge/memory.ts'
import { CodeMoveMailbox, MOVE_MAGIC } from '../bridge/code-move.ts'
import { PayloadMailbox } from '../bridge/payload.ts'
import { CodeBattle, type RememberRecord, localCodeMemory, mockWriter, type CodeWriter, type Panel, type Sandbox, type TurnInfo, type TurnRecord, type TurnResult } from './code-battle.ts'

const AT = 0x0203f4d0
const sandbox: Sandbox = { async run(source) { try { return { ok: true, value: new Function(source)() } } catch (e) { return { ok: false, error: String(e) } } } }
// ROM ids: SCRATCH 10, TACKLE 33, GROWL 45, FLY 19 (no code: not met before Erika). Types: NORMAL 0, FIRE 10, WATER 11, ROCK 5, GROUND 4.
const names = {
  moveName: (id: number) => ({ 10: 'SCRATCH', 33: 'TACKLE', 45: 'GROWL', 19: 'FLY' } as Record<number, string>)[id] ?? '?',
  speciesName: (id: number) => ({ 4: 'CHARMANDER', 5: 'CHARMELEON', 7: 'SQUIRTLE', 74: 'GEODUDE', 16: 'PIDGEY' } as Record<number, string>)[id] ?? '?',
  typeName: (id: number) => ({ 0: 'NORMAL', 2: 'FLYING', 4: 'GROUND', 5: 'ROCK', 9: 'MYSTERY', 10: 'FIRE', 11: 'WATER', 15: 'ICE' } as Record<number, string>)[id] ?? '???',
}
const instant = async () => {}

function game() {
  const memory = new GbaMemory(fakeCore()), mailbox = new CodeMoveMailbox(memory, AT)
  let id = 0
  // What the ROM does in Cmd_attackcanceler (patches/006-code-moves.patch).
  const request = (o: { move?: number; side?: 0 | 1; level?: number; attacker?: number; target?: number; types?: [number, number]; flags?: number; pid?: number; stages?: number; cls?: number; called?: number } = {}) => {
    const side = o.side ?? 0
    memory.w32(AT + 8, ++id); memory.w32(AT + 12, 0); memory.w16(AT + 16, o.move ?? 10); memory.w8(AT + 18, side); memory.w8(AT + 19, o.level ?? 5)
    memory.w16(AT + 20, o.attacker ?? (side ? 7 : 4)); memory.w16(AT + 22, o.target ?? (side ? 4 : 7))
    memory.w32(AT + 24, o.pid ?? (side ? 222 : 111)); memory.w32(AT + 28, side ? 111 : 222); memory.w8(AT + 32, 5)
    const [t1, t2] = o.types ?? (side ? [10, 10] : [11, 11]); memory.w8(AT + 33, t1); memory.w8(AT + 34, t2)
    memory.w32(AT + 36, o.flags ?? 0x8); memory.w16(AT + 40, o.flags === 0 ? 0 : 326); memory.w8(AT + 43, (o.stages ?? 0) & 0xff); memory.w8(AT + 46, o.cls ?? (o.flags === 0 ? 0 : 84)); memory.w8(AT + 47, o.called ?? 0)
    memory.w8(AT + 6, 1)
  }
  const reply = () => ({ state: memory.u8(AT + 6), verdict: memory.u8(AT + 35), reason: memory.u8(AT + 42) })
  return { memory, mailbox, request, reply }
}

function fakePanel() {
  const log: { begin: TurnInfo[]; text: string[]; end: TurnResult[] } = { begin: [], text: [], end: [] }
  const panel: Panel = { begin: i => { log.begin.push(i) }, text: (_s, d) => { log.text.push(d) }, end: async (_s, r) => { log.end.push(r) } }
  return { panel, log }
}
const fixed = (text: string): CodeWriter => ({ async write(_p, onText) { onText(text); return text } })
const store = () => localCodeMemory(null)

test('mailbox: enable, snapshot stamps the epoch, reply publishes last; stale replies refused', () => {
  const g = game()
  g.mailbox.enable()
  assert.equal(g.memory.u32(AT), MOVE_MAGIC); assert.equal(g.memory.u8(AT + 7), 1)
  g.request({ types: [11, 11] })
  const r = g.mailbox.snapshot()!
  assert.equal(r.attackerSide, 0); assert.deepEqual(r.targetTypes, [11, 11]); assert.equal(r.trainerId, 326)
  assert.ok(g.memory.u32(AT + 12) !== 0, 'epoch stamped')
  assert.equal(g.mailbox.reply({ ...r, id: r.id + 1 }, 'hit'), false)
  assert.equal(g.mailbox.reply(r, 'miss', 'over budget'), true)
  assert.deepEqual(g.reply(), { state: 2, verdict: 2, reason: 2 })
})

test('a right answer hits; the panel shows foe-format details', async () => {
  const g = game(), { panel, log } = fakePanel(), turns: TurnRecord[] = []
  const b = new CodeBattle(g.mailbox, names, mockWriter({ missEvery: 99, delay: instant }), sandbox, panel, store(), { onTurn: t => turns.push(t) })
  await b.poll()
  g.request({ move: 10 }) // CHARMANDER uses SCRATCH on SQUIRTLE (WATER)
  await b.poll()
  assert.deepEqual(g.reply(), { state: 2, verdict: 1, reason: 0 })
  assert.equal(log.begin[0]!.move, 'SLICE'); assert.equal(log.begin[0]!.type, 'WATER')
  assert.match(log.text.join(''), /function slice\(data\)/)
  assert.equal(log.end[0]!.text, "CHARMANDER's code hit!")
  assert.equal(turns[0]!.verdict, 'hit')
})

test('misses: wrong answer, crash, over budget, no code — each with its reason', async () => {
  const cases: [string, number, string][] = [
    ['```js\nfunction slice(data) { return [1, 2, 3] }\n```', 1, "CHARMANDER's code got it wrong!"],
    ['```js\nfunction slice(data) { return data.nope() }\n```', 0, "CHARMANDER's code crashed!"],
    ['```js\n' + '// '.repeat(200) + '\n```', 2, "CHARMANDER's code was too long!"],
    ['I would slice it!\n```js\nx\n```', 3, "CHARMANDER didn't write any code!"],
  ]
  for (const [text, reason, line] of cases) {
    const g = game(), { panel, log } = fakePanel()
    const b = new CodeBattle(g.mailbox, names, fixed(text), sandbox, panel, store())
    await b.poll(); g.request(); await b.poll()
    assert.deepEqual(g.reply(), { state: 2, verdict: 2, reason }, text)
    assert.equal(log.end[0]!.text, line)
  }
})

test('moves with no code yet play like plain FireRed; so does a model that fails twice', async () => {
  const g = game(), { panel, log } = fakePanel()
  let calls = 0
  const failing: CodeWriter = { async write() { calls++; throw new Error('network') } }
  const b = new CodeBattle(g.mailbox, names, failing, sandbox, panel, store())
  await b.poll(); g.request({ move: 19 }); await b.poll()
  assert.deepEqual(g.reply(), { state: 2, verdict: 0, reason: 0 }); assert.equal(calls, 0)
  g.request({ move: 10 }); await b.poll()
  assert.equal(g.reply().verdict, 0); assert.equal(calls, 2, 'retried once')
  assert.match(log.end[0]!.text, /plain FireRed/)
})

test('a retry after one failure still plays the code', async () => {
  const g = game(), { panel } = fakePanel()
  let calls = 0
  const flaky: CodeWriter = { async write(p, onText) { if (++calls === 1) throw new Error('blip'); return mockWriter({ missEvery: 99, delay: instant }).write(p, onText) } }
  const b = new CodeBattle(g.mailbox, names, flaky, sandbox, panel, store())
  await b.poll(); g.request(); await b.poll()
  assert.equal(g.reply().verdict, 1)
})

test('memory is code: my… helpers it defines stay for the battle, then it consolidates; another Pokémon starts fresh', async () => {
  const g = game(), { panel, log } = fakePanel(), mem = store()
  const records: TurnRecord[] = [], remembered: RememberRecord[] = []
  const b = new CodeBattle(g.mailbox, names, mockWriter({ missEvery: 99, delay: instant }), sandbox, panel, mem, { onTurn: r => records.push(r), onRemember: r => remembered.push(r) })
  await b.poll(); g.request({ pid: 111 }); await b.poll()
  assert.equal(log.begin[0]!.memoryCost, 0, 'carries nothing yet')
  assert.deepEqual(records[0]!.kept, ['myReadWater'], 'it kept the helper it wrote')
  g.request({ pid: 111 }); await b.poll()
  assert.equal(log.begin[1]!.memoryCost, 0, 'carrying helpers is free, and so is the last-turn line')
  assert.ok(records[1]!.memory! > 20, 'calling a helper costs its size')
  assert.deepEqual(records[1]!.carried, ['myReadWater']); assert.equal(records[1]!.usedMemory, true); assert.equal(log.end[1]!.verdict, 'hit')
  assert.deepEqual(mem.lib(111), [], 'nothing long-term until the battle ends')
  await b.battleOver()
  assert.deepEqual(mem.lib(111).map(h => h.name), ['myReadWater'], 'consolidated into long-term memory')
  assert.equal(remembered[0]!.ok, true); assert.equal(remembered[0]!.cap, 80 + 5 * 5)
  g.request({ pid: 999 }); await b.poll()
  assert.equal(log.begin[2]!.memoryCost, 0, 'nothing shared between Pokémon')
  g.request({ pid: 111 }); await b.poll()
  assert.deepEqual(records[3]!.carried, ['myReadWater'], 'long-term memory rides into the next battle')
})

test('consolidation can lose things: what does not compile or fit is gone; a failed call keeps the old memory', async () => {
  const g = game(), { panel } = fakePanel(), mem = store()
  mem.setLib(111, [{ name: 'myOld', src: 'const myOld = 1;' }])
  let reply = '```js\nfunction myGood(d){return d}\nfunction myBad(d){ return (( }\nconst myHuge = "' + 'x'.repeat(200) + '";\n```'
  const writer: CodeWriter = { async write(p, onText) { return p.meta.remember ? reply : mockWriter({ missEvery: 99, delay: instant }).write(p, onText) } }
  const b = new CodeBattle(g.mailbox, names, writer, sandbox, panel, mem)
  await b.poll(); g.request({ pid: 111 }); await b.poll()
  await b.battleOver()
  assert.deepEqual(mem.lib(111).map(h => h.name), ['myGood'], 'the old helper was dropped, the broken one and the oversized one too')
  const failing: CodeWriter = { async write(p, onText) { if (p.meta.remember) throw new Error('offline'); return mockWriter({ missEvery: 99, delay: instant }).write(p, onText) } }
  const c = new CodeBattle(g.mailbox, names, failing, sandbox, panel, mem)
  await c.poll(); g.request({ pid: 111 }); await c.poll()
  await c.battleOver()
  assert.deepEqual(mem.lib(111).map(h => h.name), ['myGood'], 'no answer: memory unchanged')
  reply = 'no code at all'
})

test('an old save: readers learned under the old rule become long-term helpers', async () => {
  const g = game(), { panel } = fakePanel(), mem = store()
  const records: TurnRecord[] = []
  mem.setReaders(111, { WATER: "const nums = data.split('\\n').map(Number)" })
  const b = new CodeBattle(g.mailbox, names, mockWriter({ missEvery: 99, delay: instant }), sandbox, panel, mem, { onTurn: r => records.push(r) })
  await b.poll(); g.request({ pid: 111 }); await b.poll()
  assert.deepEqual(records[0]!.carried, ['myReadWater'])
  assert.deepEqual(mem.readers(111), {})
})

test('foes write on pure instinct: wild, trainers, the rival and leaders alike', async () => {
  const g = game(), { panel, log } = fakePanel(), mem = store()
  const b = new CodeBattle(g.mailbox, names, mockWriter({ missEvery: 99, delay: instant }), sandbox, panel, mem)
  await b.poll()
  g.request({ side: 1, attacker: 16, flags: 0 }); await b.poll()                 // wild PIDGEY
  g.request({ side: 1, attacker: 7, flags: 0x8, cls: 81 }); await b.poll()       // the rival's SQUIRTLE
  g.request({ side: 1, attacker: 7, flags: 0x8, cls: 84 }); await b.poll()       // a gym leader
  assert.equal(log.begin[0]!.wild, true); assert.equal(log.begin[1]!.wild, false)
  for (const i of log.begin) { assert.equal(i.memoryCost, 0); assert.equal(i.recalls, undefined) } // nothing carried, nothing recalled
  assert.deepEqual(mem.readers(0), {}, 'foes never learn')
})

test('the first battle is a tutorial: a plain list, no format', async () => {
  const g = game(), { panel, log } = fakePanel()
  const seen: string[] = []
  const spy: CodeWriter = { async write(p, onText) { seen.push(p.user); return mockWriter({ missEvery: 99, delay: instant }).write(p, onText) } }
  const b = new CodeBattle(g.mailbox, names, spy, sandbox, panel, store())
  await b.poll(); g.request({ flags: 0x8 | 0x10 }); await b.poll()
  assert.equal(log.begin[0]!.tutorial, true)
  assert.match(seen[0]!, /a plain list of numbers/); assert.doesNotMatch(seen[0]!, /WATER format/)
  assert.equal(g.reply().verdict, 1)
})

test('badges: Boulder +30 and Cascade +50 bytes (no readers any more); evolution raises the budget', async () => {
  const g = game(), { panel, log } = fakePanel()
  const b = new CodeBattle(g.mailbox, names, mockWriter({ missEvery: 99, delay: instant }), sandbox, panel, store(), { badges: () => ['BOULDER', 'CASCADE'] })
  await b.poll(); g.request({ target: 74, types: [5, 4], attacker: 5, level: 16 }); await b.poll()
  assert.equal(log.begin[0]!.budget, 300 + 160 + 100 + 30 + 50)
})

test('every FireRed type has a format now; the ??? type sends a plain list', async () => {
  const g = game(), { panel, log } = fakePanel()
  const b = new CodeBattle(g.mailbox, names, mockWriter({ missEvery: 99, delay: instant }), sandbox, panel, store())
  await b.poll(); g.request({ types: [15, 15] }); await b.poll()
  assert.equal(log.begin[0]!.type, 'ICE')
  g.request({ types: [9, 9] }); await b.poll()   // 9 = MYSTERY in this fake names table
  assert.equal(log.begin[1]!.type, 'NORMAL')
})

test('local code memory persists across page loads', () => {
  const data = new Map<string, string>()
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) } }
  const a = localCodeMemory(storage)
  a.setReaders(5, { ROCK: 'const bytes = x' }); a.addSeen(['ROCK', 'ROCK'])
  for (let i = 0; i < 25; i++) a.remember!(5, { at: i, move: 'SCRATCH', type: 'NORMAL', target: 'RATTATA', verdict: 'hit', notch: 0, budget: 300, code: `// ${i}` })
  const b = localCodeMemory(storage)
  assert.deepEqual(b.readers(5), { ROCK: 'const bytes = x' }); assert.deepEqual(b.seen(), ['ROCK'])
  assert.equal(b.recent!(5).length, 20); assert.equal(b.recent!(5)[0]!.at, 5) // last 20 kept
  const bundle = b.export!()
  const c = localCodeMemory(null); c.import!(bundle)
  assert.deepEqual(c.export!(), bundle)
})

test('a player turn is remembered in the Pokémon\'s code history; foe turns are not', async () => {
  const g = game(), { panel } = fakePanel()
  const minds = store()
  const b = new CodeBattle(g.mailbox, names, mockWriter({ missEvery: 99, delay: instant }), sandbox, panel, minds)
  await b.poll(); g.request({ side: 0 }); await b.poll()
  g.request({ side: 1 }); await b.poll()
  const mine = minds.recent!(111)
  assert.deepEqual(minds.recent!(222), [])
  assert.equal(mine.length, 1)
  assert.equal(mine[0]!.verdict, 'hit'); assert.match(mine[0]!.code, /function/)
})

test('status moves hit the code: Growl on the attacker shakes it (smaller budget, hotter writing); its own Withdraw steadies it', async () => {
  const g = game(), { panel, log } = fakePanel()
  const temps: number[] = []
  const spy: CodeWriter = { async write(p, onText) { temps.push(p.temperature); return mockWriter({ missEvery: 99, delay: instant }).write(p, onText) } }
  const b = new CodeBattle(g.mailbox, names, spy, sandbox, panel, store())
  await b.poll(); g.request({ stages: -3 }); await b.poll()
  assert.equal(log.begin[0]!.notch, -2); assert.equal(log.begin[0]!.budget, 280)
  g.request({ stages: 1 }); await b.poll()
  assert.equal(log.begin[1]!.notch, 1); assert.equal(log.begin[1]!.budget, 385)
  assert.ok(temps[0]! > temps[1]!, 'shaken writes hotter than steadied')
  const r = g.mailbox.snapshot.bind(g.mailbox); g.request({ stages: -3 }); assert.equal(r()!.attackerStages, -3, 'signed byte read')
})

test('one context budget: your note costs bytes, a helper costs when called; the code must fit in the rest', async () => {
  const g = game(), { panel, log } = fakePanel(), mem = store()
  const seen: string[] = []
  const spy: CodeWriter = { async write(p, onText) { seen.push(p.user); return mockWriter({ missEvery: 99, delay: instant }).write(p, onText) } }
  mem.setHot(111, 'always use const; never use var')
  const b = new CodeBattle(g.mailbox, names, spy, sandbox, panel, mem)
  await b.poll(); g.request({ pid: 111 }); await b.poll()
  assert.equal(log.begin[0]!.memoryCost, 'always use const; never use var'.length)
  assert.match(seen[0]!, /- Your notes: always use const; never use var/)
  assert.match(seen[0]!, new RegExp(`at most ${350 - 31} characters`))
  // the helper it kept costs bytes on the next turn, and the prompt shows it
  g.request({ pid: 111 }); await b.poll()
  assert.equal(log.begin[1]!.memoryCost, 31, 'the note costs; carrying helpers and the last-turn line are free')
  assert.match(seen[1]!, /- Last turn: SLICE on WATER data hit\./)
  assert.match(seen[1]!, /Helpers you carry \(already defined: call them, don't write them again; each one you call costs its size from your budget\):\nfunction myReadWater\(/)
  assert.match(seen[0]!, /You carry no WATER reader yet\. If this block defines a working function myReadWater\(data\)/)
  assert.doesNotMatch(seen[1]!, /You carry no WATER reader/, 'no offer once it carries one')
})

test('a long note can push correct code over budget: that is the trade-off', async () => {
  const g = game(), { panel, log } = fakePanel(), mem = store()
  mem.setHot(111, 'x'.repeat(330))
  const b = new CodeBattle(g.mailbox, names, mockWriter({ missEvery: 99, delay: instant }), sandbox, panel, mem)
  await b.poll(); g.request({ pid: 111 }); await b.poll()
  assert.equal(log.end[0]!.reason, 'over budget')
})

test('payload move: a hit hands the bytes to the game before the reply; a miss hands nothing', async () => {
  const g = game(), { panel, log } = fakePanel()
  const memory = g.memory, PTR = 0x02010000, AT = 0x02021000
  memory.w32(PTR, AT) // the symbol points at the battle's heap mailbox
  const payload = new PayloadMailbox(memory, PTR)
  const b = new CodeBattle(g.mailbox, names, mockWriter({ missEvery: 2, delay: instant }), sandbox, panel, store(), { payload, onTurn: r => turns.push(r) })
  const turns: TurnRecord[] = []
  await b.poll(); g.request({ move: 45 }); await b.poll() // GROWL = ERROR: the mock writes the buzz
  assert.equal(g.reply().verdict, 1)
  assert.equal(memory.u8(AT + 6), 1); assert.equal(memory.u16(AT + 8), 3199) // every number plays (payload moves read nothing of the foe)
  assert.equal(turns[0]!.payload, 'sound')
  memory.w8(AT + 6, 0) // the game played it
  g.request({ move: 45 }); await b.poll() // the mock's every-2nd mistake: three samples → too short → miss, nothing delivered
  assert.equal(g.reply().verdict, 2)
  assert.equal(memory.u8(AT + 6), 0)
  assert.match(log.end.at(-1)!.detail ?? '', /at least 1000/)
})

test('doubt: the ROM says it used its own pick; the panel names the call it doubted; its code is not shaken', async () => {
  const g = game(), { panel, log } = fakePanel()
  const temps: number[] = []
  const spy: CodeWriter = { async write(p, onText) { temps.push(p.temperature); return mockWriter({ missEvery: 99, delay: instant }).write(p, onText) } }
  const turns: TurnRecord[] = []
  const b = new CodeBattle(g.mailbox, names, spy, sandbox, panel, store(), { calledMove: req => (req.calledSlot === 2 ? 'ERROR' : null), onTurn: r => turns.push(r) })
  await b.poll(); g.request({ move: 10 }); await b.poll()               // SLICE, as called
  g.request({ move: 10, called: 2 }); await b.poll()                    // SLICE, though you called ERROR (slot 1)
  assert.equal(log.begin[0]!.doubt, undefined)
  assert.deepEqual(log.begin[1]!.doubt, { called: 'ERROR' })
  assert.equal(log.begin[1]!.notch, 0); assert.equal(temps[1], temps[0]); assert.equal(log.begin[1]!.budget, log.begin[0]!.budget)
  assert.equal(turns[1]!.doubted, 'ERROR'); assert.equal(turns[0]!.doubted, undefined)
})

test('a right reader under a wrong answer is still kept; a non-reader helper only from a hit', async () => {
  const g = game(), { panel } = fakePanel(), mem = store()
  const records: TurnRecord[] = []
  let n = 0
  const writer: CodeWriter = { async write(p, onText) {
    if (p.meta.remember) return '```js\n```'
    n++
    // turn 1: a right WATER reader, a wrong answer (one too many); turn 2: a hit with a plain helper
    const text = n === 1 ? "```js\nfunction myReadWater(data) { return data.split('\\n').map(Number) }\nconst myJunk = 1\nfunction slice(data) { return myReadWater(data).slice(0, 4) }\n```"
      : "```js\nconst myMax = xs => Math.max(...xs)\nfunction slice(data) { return myReadWater(data).slice(0, 3) }\n```"
    onText(text); return text
  } }
  const b = new CodeBattle(g.mailbox, names, writer, sandbox, panel, mem, { onTurn: r => records.push(r) })
  await b.poll(); g.request({ pid: 111 }); await b.poll()
  assert.equal(records[0]!.verdict, 'miss'); assert.deepEqual(records[0]!.kept, ['myReadWater'], 'the reader checked out; myJunk did not count under a miss')
  g.request({ pid: 111 }); await b.poll()
  assert.equal(records[1]!.verdict, 'hit'); assert.deepEqual(records[1]!.kept, ['myReadWater', 'myMax'])
})

test('working memory of the last turn: a miss comes back as a line with what went wrong; gone when the battle ends', async () => {
  const g = game(), { panel } = fakePanel(), mem = store()
  const seen: string[] = []
  const spy: CodeWriter = { async write(p, onText) { seen.push(p.user); return mockWriter({ missEvery: 1, delay: instant }).write(p, onText) } } // every turn off by one
  const b = new CodeBattle(g.mailbox, names, spy, sandbox, panel, mem)
  await b.poll(); g.request({ pid: 111 }); await b.poll()
  assert.doesNotMatch(seen[0]!, /Last turn/)
  g.request({ pid: 111 }); await b.poll()
  assert.match(seen[1]!, /- Last turn: SLICE on WATER data missed \(got \[[\d,]+\], needed \[[\d,]+\]\)\. Do it differently\./)
  await b.battleOver()
  g.request({ pid: 111 }); await b.poll()
  assert.doesNotMatch(seen[2]!, /Last turn/, 'working memory dies with the battle')
})

test('rune moves (RUNES knob): no foe data in the prompt, glyphs on the panel, the four miss reasons, a plain move still reads', async () => {
  const { RUNES } = await import('../../../rules/index.mjs')
  RUNES.enabled = true
  try {
    const g = game(), { panel, log } = fakePanel(), turns: TurnRecord[] = []
    const seen: { system: string; user: string }[] = []
    const mock = mockWriter({ missEvery: 2, delay: instant })
    const spy: CodeWriter = { async write(p, onText) { seen.push(p); return mock.write(p, onText) } }
    const b = new CodeBattle(g.mailbox, names, spy, sandbox, panel, store(), { onTurn: t => turns.push(t) })
    await b.poll(); g.request({ move: 33 }); await b.poll() // TACKLE → PING, in runes
    assert.equal(log.begin[0]!.move, 'PING'); assert.match(log.begin[0]!.runes!.want, /a file: 4 to 8 numbers/)
    assert.match(seen[0]!.user, /Move: PING \(Normal\)\. Sing a file/); assert.doesNotMatch(seen[0]!.user, /data|format/i)
    assert.deepEqual(g.reply(), { state: 2, verdict: 1, reason: 0 })
    assert.equal(log.end[0]!.text, "CHARMANDER's code hit!")
    assert.doesNotMatch(log.end[0]!.runes!.glyphs, /put|count/, 'the strip has no op words'); assert.match(log.end[0]!.runes!.glyphs, /^⊕ 04  ⊕ /)
    assert.match(log.end[0]!.runes!.program, /^put 4\nput /); assert.match(log.end[0]!.runes!.js, /^let t = \[\]/)
    assert.equal(log.end[0]!.runes!.tape!.length, 5)
    assert.equal(turns[0]!.runes, true); assert.equal(turns[0]!.verdict, 'hit')
    g.request({ move: 33 }); await b.poll() // the stand-in writes the wrong key every second turn
    assert.deepEqual(g.reply(), { state: 2, verdict: 2, reason: 1 }); assert.equal(log.end[1]!.reason, 'wrong answer'); assert.match(log.end[1]!.detail!, /sang \[.*needed a file/)
    for (const [text, reason, code] of [['', 'no code', 3], ['return 4', 'crashed', 0], ['stream 9 3', 'crashed', 0], ['put 4\nput 1 2 3 4\n'.repeat(20), 'over budget', 2]] as const) {
      const f = new CodeBattle(g.mailbox, names, fixed(text), sandbox, panel, store())
      g.request({ move: 33 }); await f.poll()
      assert.equal(g.reply().reason, code, reason); assert.equal(log.end.at(-1)!.reason, reason)
    }
    g.request({ move: 10 }); await b.poll() // SCRATCH → SLICE has no runes yet: it still reads the foe
    assert.equal(log.begin.at(-1)!.runes, undefined); assert.match(seen.at(-1)!.user, /WATER format/); assert.equal(turns.at(-1)!.runes, undefined)
    g.request({ move: 33, flags: 0x8 | 0x10 }); await b.poll() // the first battle never uses runes
    assert.equal(log.begin.at(-1)!.tutorial, true); assert.equal(log.begin.at(-1)!.runes, undefined)
  } finally { RUNES.enabled = false }
})
