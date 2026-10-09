import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GbaMemory, fakeCore } from '../bridge/memory.ts'
import { CodeMoveMailbox, MOVE_MAGIC } from '../bridge/code-move.ts'
import { CodeBattle, localCodeMemory, mockWriter, type CodeWriter, type Panel, type Sandbox, type TurnInfo, type TurnRecord, type TurnResult } from './code-battle.ts'

const AT = 0x0203f4d0
const sandbox: Sandbox = { async run(source) { try { return { ok: true, value: new Function(source)() } } catch (e) { return { ok: false, error: String(e) } } } }
// ROM ids: SCRATCH 10, TACKLE 33, GROWL 45, HYPER BEAM 63 (no code yet). Types: NORMAL 0, FIRE 10, WATER 11, ROCK 5, GROUND 4.
const names = {
  moveName: (id: number) => ({ 10: 'SCRATCH', 33: 'TACKLE', 45: 'GROWL', 63: 'HYPER BEAM' } as Record<number, string>)[id] ?? '?',
  speciesName: (id: number) => ({ 4: 'CHARMANDER', 5: 'CHARMELEON', 7: 'SQUIRTLE', 74: 'GEODUDE', 16: 'PIDGEY' } as Record<number, string>)[id] ?? '?',
  typeName: (id: number) => ({ 0: 'NORMAL', 2: 'FLYING', 4: 'GROUND', 5: 'ROCK', 9: 'MYSTERY', 10: 'FIRE', 11: 'WATER', 15: 'ICE' } as Record<number, string>)[id] ?? '???',
}
const instant = async () => {}

function game() {
  const memory = new GbaMemory(fakeCore()), mailbox = new CodeMoveMailbox(memory, AT)
  let id = 0
  // What the ROM does in Cmd_attackcanceler (patches/006-code-moves.patch).
  const request = (o: { move?: number; side?: 0 | 1; level?: number; attacker?: number; target?: number; types?: [number, number]; flags?: number; pid?: number; stages?: number; cls?: number } = {}) => {
    const side = o.side ?? 0
    memory.w32(AT + 8, ++id); memory.w32(AT + 12, 0); memory.w16(AT + 16, o.move ?? 10); memory.w8(AT + 18, side); memory.w8(AT + 19, o.level ?? 5)
    memory.w16(AT + 20, o.attacker ?? (side ? 7 : 4)); memory.w16(AT + 22, o.target ?? (side ? 4 : 7))
    memory.w32(AT + 24, o.pid ?? (side ? 222 : 111)); memory.w32(AT + 28, side ? 111 : 222); memory.w8(AT + 32, 5)
    const [t1, t2] = o.types ?? (side ? [10, 10] : [11, 11]); memory.w8(AT + 33, t1); memory.w8(AT + 34, t2)
    memory.w32(AT + 36, o.flags ?? 0x8); memory.w16(AT + 40, o.flags === 0 ? 0 : 326); memory.w8(AT + 43, (o.stages ?? 0) & 0xff); memory.w8(AT + 46, o.cls ?? (o.flags === 0 ? 0 : 84))
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
  assert.equal(log.begin[0]!.move, 'SLICE'); assert.equal(log.begin[0]!.type, 'WATER'); assert.equal(log.begin[0]!.know, null)
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
  await b.poll(); g.request({ move: 63 }); await b.poll()
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

test('learning: a verified reader is remembered by that Pokémon; the Pokédex fills after the battle', async () => {
  const g = game(), { panel, log } = fakePanel(), mem = store()
  const b = new CodeBattle(g.mailbox, names, mockWriter({ missEvery: 99, delay: instant }), sandbox, panel, mem)
  await b.poll(); g.request({ pid: 111 }); await b.poll()
  assert.deepEqual(Object.keys(mem.readers(111)), ['WATER'])
  assert.deepEqual(mem.readers(999), {}, 'another Pokémon starts fresh')
  g.request({ pid: 111 }); await b.poll()
  assert.equal(log.begin[1]!.know, 'memory')
  assert.deepEqual(mem.seen(), [], 'not in the Pokédex during the battle')
  b.battleOver()
  assert.deepEqual(mem.seen(), ['WATER'])
  g.request({ pid: 999 }); await b.poll()
  assert.equal(log.begin[2]!.know, 'dex', 'the Pokédex is shared by the party')
})

test('foes: wild ones know no readers; leaders and the rival read every format; ordinary trainers about half', async () => {
  const g = game(), { panel, log } = fakePanel(), mem = store()
  const b = new CodeBattle(g.mailbox, names, mockWriter({ missEvery: 99, delay: instant }), sandbox, panel, mem)
  await b.poll()
  g.request({ side: 1, attacker: 16, flags: 0 }); await b.poll()                 // wild PIDGEY
  assert.equal(log.begin[0]!.know, null); assert.equal(log.begin[0]!.wild, true)
  g.request({ side: 1, attacker: 7, flags: 0x8, cls: 81 }); await b.poll()       // the rival's SQUIRTLE
  assert.equal(log.begin[1]!.know, 'dex')
  const knows = new Set<string | null>()
  for (let pid = 1; pid <= 12; pid++) { g.request({ side: 1, attacker: 7, flags: 0x8, cls: 2, pid: pid * 104729 }); await b.poll(); knows.add(log.begin.at(-1)!.know) }
  assert.ok(knows.has('dex') && knows.has(null), 'an ordinary trainer reads some formats and not others')
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

test('badges teach: Boulder gives ROCK + GROUND readers, Cascade +50 bytes; evolution raises the budget', async () => {
  const g = game(), { panel, log } = fakePanel()
  const b = new CodeBattle(g.mailbox, names, mockWriter({ missEvery: 99, delay: instant }), sandbox, panel, store(), { badges: () => ['BOULDER', 'CASCADE'] })
  await b.poll(); g.request({ target: 74, types: [5, 4], attacker: 5, level: 16 }); await b.poll()
  assert.equal(log.begin[0]!.know, 'dex')
  assert.equal(log.begin[0]!.budget, 300 + 160 + 100 + 50)
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

test('one context budget: the reader it uses and its hot memory cost bytes; the code must fit in the rest', async () => {
  const g = game(), { panel, log } = fakePanel(), mem = store()
  const seen: string[] = []
  const spy: CodeWriter = { async write(p, onText) { seen.push(p.user); return mockWriter({ missEvery: 99, delay: instant }).write(p, onText) } }
  mem.setHot(111, 'always use const; never use var')
  const b = new CodeBattle(g.mailbox, names, spy, sandbox, panel, mem)
  await b.poll(); g.request({ pid: 111 }); await b.poll()
  assert.equal(log.begin[0]!.memoryCost, 'always use const; never use var'.length)
  assert.match(seen[0]!, /- Your notes: always use const; never use var/)
  assert.match(seen[0]!, new RegExp(`at most ${350 - 31} characters`))
  // a learned reader now costs on use: next turn the WATER reader is charged too
  g.request({ pid: 111 }); await b.poll()
  assert.ok(log.begin[1]!.memoryCost > 31, 'reader + notes')
  assert.equal(log.begin[1]!.know, 'memory')
})

test('a long note can push correct code over budget: that is the trade-off', async () => {
  const g = game(), { panel, log } = fakePanel(), mem = store()
  mem.setHot(111, 'x'.repeat(330))
  const b = new CodeBattle(g.mailbox, names, mockWriter({ missEvery: 99, delay: instant }), sandbox, panel, mem)
  await b.poll(); g.request({ pid: 111 }); await b.poll()
  assert.equal(log.end[0]!.reason, 'over budget')
})
