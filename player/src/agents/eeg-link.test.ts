import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GbaMemory, fakeCore } from '../bridge/memory.ts'
import { EEG_MAGIC, EegMailbox, encodeText, wrapNote } from '../bridge/eeg.ts'
import { decodeText } from './battle.ts'
import { localCodeMemory } from './code-battle.ts'
import { EegLink, mindOf } from './eeg-link.ts'

const AT = 0x02020000
function game() {
  const memory = new GbaMemory(fakeCore()), mailbox = new EegMailbox(memory, AT)
  let id = 0
  // What the ROM does in Eeg_Ask (patches/008-pokeeg.patch).
  const ask = (op: 1 | 2, o: { pid?: number; species?: number; level?: number } = {}) => {
    memory.w8(AT + 6, 0); memory.w32(AT, EEG_MAGIC); memory.w16(AT + 4, 2); memory.w8(AT + 7, op); memory.w32(AT + 8, ++id)
    memory.w32(AT + 16, o.pid ?? 111); memory.w16(AT + 20, o.species ?? 4); memory.w8(AT + 22, o.level ?? 12); memory.w8(AT + 23, 1)
    memory.w8(AT + 6, 1)
  }
  const close = () => { memory.w8(AT + 23, 0); memory.w8(AT + 6, 0) }
  const text = (off: number, n: number) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = memory.u8(AT + off + i); return decodeText(b) }
  return { memory, mailbox, ask, close, text, state: () => memory.u8(AT + 6) }
}
const names = { speciesName: (s: number) => (s === 4 ? 'CHARMANDER' : 'SQUIRTLE'), typeOf: (s: number) => (s === 4 ? 'FIRE' : 'WATER') as 'FIRE' | 'WATER' }

test('encodeText round-trips through decodeText and fits the field', () => {
  const bytes = encodeText('return a plain number: 42, ok!', 24)
  assert.equal(bytes.length, 24)
  assert.equal(decodeText(bytes), 'return a plain number: ')
  assert.equal(decodeText(encodeText('PokÉEG · x', 16)), 'PokÉEG · x')
})

test('mindOf: readers, Pokédex, budget, focus, last turns, short format, hot memory', () => {
  const minds = localCodeMemory(null)
  minds.setReaders(111, { ROCK: 'a', WATER: 'b' }); minds.addSeen(['ROCK', 'GRASS', 'NORMAL']); minds.setHot(111, 'be brave')
  for (const v of ['hit', 'miss', 'hit'] as const) minds.remember!(111, { at: 0, move: 'EMBER', type: 'FIRE', target: 'SQUIRTLE', verdict: v, notch: 0, budget: 300, code: '' })
  const m = mindOf({ personality: 111, species: 4, level: 12 }, { minds, badges: () => ['BOULDER'], ...names })
  assert.equal(m.readers, 2); assert.equal(m.dex, 4) // 3 seen + the badge's reader
  assert.ok(m.budget > 400)
  assert.deepEqual(m.history, [true, false, true])
  assert.equal(m.format, 'write log'); assert.equal(m.hot, 'be brave'); assert.ok(m.focus > 0 && m.focus <= 100)
  assert.equal(m.readersText, 'Rock, Water'); assert.equal(m.dexText, 'Rock, Grass, Normal, Ground')
})

test('link: answers a mind request, follows the cursor, runs the editor and writes the note back', async () => {
  const g = game()
  const minds = localCodeMemory(null)
  minds.setHot(111, 'old note')
  const followed: (number | null)[] = []
  let resolveEdit: ((t: string | null) => void) | undefined
  let edited: { pid: number; name: string; current: string } | undefined
  const link = new EegLink({ mailbox: g.mailbox, minds, badges: () => [], ...names, follow: p => followed.push(p),
    editor: (pid, name, current) => { edited = { pid, name, current }; return new Promise(r => { resolveEdit = r }) } })
  g.ask(1)
  link.poll()
  assert.equal(g.state(), 2)
  assert.equal(g.text(40, 24), 'write log'); assert.equal(g.text(64, 100), 'old note'); assert.equal(g.text(164, 48), ''); assert.equal(g.text(212, 48), '')
  assert.deepEqual(followed, [111])
  g.ask(2)
  link.poll()
  assert.equal(link.editingNow, true)
  assert.deepEqual(edited, { pid: 111, name: 'CHARMANDER', current: 'old note' })
  resolveEdit!('new note')
  await new Promise(r => setTimeout(r, 0))
  assert.equal(g.state(), 2); assert.equal(minds.hot(111), 'new note'); assert.equal(link.editingNow, false)
  g.close(); link.poll()
  assert.deepEqual(followed, [111, null])
})

test('link: the game cancels the editor (B) → the page editor is aborted and nothing is written', async () => {
  const g = game()
  const minds = localCodeMemory(null)
  let signal: AbortSignal | undefined
  const link = new EegLink({ mailbox: g.mailbox, minds, badges: () => [], ...names,
    editor: (_p, _n, _c, s) => { signal = s; return new Promise(r => s.addEventListener('abort', () => r(null))) } })
  g.ask(2); link.poll()
  assert.equal(signal?.aborted, false)
  g.memory.w8(AT + 6, 4) // B in the game
  link.poll()
  assert.equal(signal?.aborted, true); assert.equal(link.editingNow, false)
  await new Promise(r => setTimeout(r, 0))
  assert.equal(minds.hot(111), ''); assert.equal(g.state(), 4)
})

test('wrapNote: two lines of 30, longer notes end with …; the newline survives encoding', () => {
  assert.equal(wrapNote('be brave'), 'be brave')
  assert.equal(wrapNote('always return a plain number, never a list or a string'), 'always return a plain number,\nnever a list or a string')
  const long = wrapNote('one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen')
  assert.equal(long.split('\n').length, 2); assert.ok(long.endsWith('…'))
  assert.equal(encodeText('a\nb', 4)[1], 0xFE)
})
