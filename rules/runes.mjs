// Runes (prototype, owner, 2026-10-12): a Pokémon does not write JavaScript about the foe's data; it writes a
// short program in a tiny tape language and the program EMITS bytes of the MOVE's type. A Water move emits a
// stream, a Fire move a write, a Rock move raw bytes, an Electric move a signal, a Normal move a file. The judge
// checks what came out (shape and character, as the sound and picture moves already are), not an answer.
//
// The language: a tape of numbers (empty at the start) and a line of ops. Every op is one of the type families,
// so what a Pokémon writes is made of the same stuff as its moves. The model writes the op names; the page shows
// glyphs until the trainer holds the DECODER (Oak's parcel), which shows the names and the JavaScript meaning.
//
//   put 42 13 140        Normal   append numbers
//   count                Normal   append how many there are
//   take 3 · drop 2      Normal   keep the first n · remove the first n
//   rev                  Normal   reverse
//   dup                  Normal   append a copy of the whole tape
//   stream 4 9 40        Water    append numbers that must rise (each greater than the last: a stream flows)
//   filter < 100         Water    keep the numbers under n (also > n)
//   flush                Water    empty the tape
//   write 2 77           Fire     set the number at index n to v
//   add 5                Fire     every number plus n (negative n takes away)
//   set 200              Fire     every number becomes v
//   grow 3               Grass    the tape repeated n times
//   sum                  Grass    append the sum
//   peak                 Electric append the largest
//   spike 150            Electric append v (a spike must be the largest on the tape)
//   cut                  Electric remove the largest
//   raw ff 0a 7e         Rock     append bytes written in hex
//   checksum             Rock     append the sum mod 256
//   sort                 Psychic  smallest first
//   cap 100 · mod 10     Ground   each number at most n · each number mod n
//   mul 2                Fighting every number times n
//   scale 2              Flying   every number divided by n, rounded down
//   xor 255              Steel    every number XOR n
//   peek 1               Ghost    append the number at index n
//   loop 3 … end                   repeat the ops between, n times
// Numbers are 0–255 after every op (the tape holds bytes: larger values wrap, negatives become 0).
import { formatOf } from './turn.mjs'

/** Every op: its type family, how many arguments (−1: a list of numbers), its glyph, and its JavaScript meaning (t = the tape). */
export const OPS = {
  put: { type: 'Normal', args: -1, glyph: '⊕', js: (a) => `t.push(${a.join(', ')})` },
  count: { type: 'Normal', args: 0, glyph: '№', js: () => 't.push(t.length)' },
  take: { type: 'Normal', args: 1, glyph: '⊏', js: ([n]) => `t = t.slice(0, ${n})` },
  drop: { type: 'Normal', args: 1, glyph: '⊐', js: ([n]) => `t = t.slice(${n})` },
  rev: { type: 'Normal', args: 0, glyph: '↺', js: () => 't.reverse()' },
  dup: { type: 'Normal', args: 0, glyph: '⫴', js: () => 't.push(...t)' },
  stream: { type: 'Water', args: -1, glyph: '≋', js: (a) => `t.push(${a.join(', ')}) // must rise` },
  filter: { type: 'Water', args: 2, glyph: '⋔', js: ([c, n]) => `t = t.filter(x => x ${c} ${n})` },
  flush: { type: 'Water', args: 0, glyph: '⌀', js: () => 't = []' },
  write: { type: 'Fire', args: 2, glyph: '✎', js: ([i, v]) => `t[${i}] = ${v}` },
  add: { type: 'Fire', args: 1, glyph: '⁺', js: ([n]) => `t = t.map(x => x + ${n})` },
  set: { type: 'Fire', args: 1, glyph: '≔', js: ([v]) => `t = t.map(() => ${v})` },
  grow: { type: 'Grass', args: 1, glyph: '⟡', js: ([n]) => `t = Array(${n}).fill(t).flat()` },
  sum: { type: 'Grass', args: 0, glyph: '∑', js: () => 't.push(t.reduce((a, x) => a + x, 0))' },
  peak: { type: 'Electric', args: 0, glyph: '⌁', js: () => 't.push(Math.max(...t))' },
  spike: { type: 'Electric', args: 1, glyph: '⚡', js: ([v]) => `t.push(${v}) // must be the largest` },
  cut: { type: 'Electric', args: 0, glyph: '⌇', js: () => 't.splice(t.indexOf(Math.max(...t)), 1)' },
  raw: { type: 'Rock', args: -1, glyph: '▦', js: (a) => `t.push(${a.map(x => '0x' + x.toString(16).padStart(2, '0')).join(', ')})` },
  checksum: { type: 'Rock', args: 0, glyph: '⌗', js: () => 't.push(t.reduce((a, x) => a + x, 0) % 256)' },
  sort: { type: 'Psychic', args: 0, glyph: '⋮', js: () => 't.sort((a, b) => a - b)' },
  cap: { type: 'Ground', args: 1, glyph: '⌈', js: ([n]) => `t = t.map(x => Math.min(x, ${n}))` },
  mod: { type: 'Ground', args: 1, glyph: '%', js: ([n]) => `t = t.map(x => x % ${n})` },
  mul: { type: 'Fighting', args: 1, glyph: '×', js: ([n]) => `t = t.map(x => x * ${n})` },
  scale: { type: 'Flying', args: 1, glyph: '÷', js: ([n]) => `t = t.map(x => Math.floor(x / ${n}))` },
  xor: { type: 'Steel', args: 1, glyph: '⊻', js: ([n]) => `t = t.map(x => x ^ ${n})` },
  peek: { type: 'Ghost', args: 1, glyph: '◌', js: ([i]) => `t.push(t[${i}])` },
  loop: { type: 'Grass', args: 1, glyph: '⟲', js: ([n]) => `for (let i = 0; i < ${n}; i++) {` },
  end: { type: 'Grass', args: 0, glyph: '⟳', js: () => '}' },
}
export const OP_NAMES = Object.keys(OPS)
const byte = x => (Number.isFinite(x) ? Math.max(0, Math.round(x)) & 255 : 0)
const STEP_LIMIT = 400  // ops executed before the program is cut off (a loop that never ends)
const TAPE_LIMIT = 64   // numbers the tape holds

/** The program as a list of { op, args }, or a parse error. Lines or `|` separate ops; a ``` fence is ignored. */
export function parseRunes(text) {
  const body = String(text ?? '').replace(/```[a-z]*/gi, '').trim()
  if (!body) return { error: 'no program' }
  const ops = []
  for (const raw of body.split(/[\n|;]+/)) {
    const line = raw.replace(/\/\/.*$/, '').replace(/#.*$/, '').trim()
    if (!line) continue
    const [name, ...rest] = line.split(/\s+/)
    const op = name.toLowerCase()
    const spec = OPS[op]
    if (!spec) return { error: `unknown op ${name}` }
    if (op === 'filter') {
      if (rest.length !== 2 || !['<', '>'].includes(rest[0]) || !/^-?\d+$/.test(rest[1])) return { error: 'filter needs < n or > n' }
      ops.push({ op, args: [rest[0], Number(rest[1])] })
      continue
    }
    const args = rest.map(a => (op === 'raw' ? parseInt(a, 16) : Number(a)))
    if (args.some(a => !Number.isFinite(a))) return { error: `${name} needs numbers` }
    if (spec.args >= 0 && args.length !== spec.args) return { error: `${name} takes ${spec.args} number${spec.args === 1 ? '' : 's'}` }
    if (spec.args < 0 && !args.length) return { error: `${name} needs numbers` }
    ops.push({ op, args })
  }
  let depth = 0
  for (const { op } of ops) { if (op === 'loop') depth++; if (op === 'end') depth--; if (depth < 0) return { error: 'end without loop' } }
  if (depth) return { error: 'loop without end' }
  return { ops }
}

/** Run a parsed program: the tape it leaves, or an error (a stream that fell, a spike that was not the largest, a loop that never ended). */
export function runTape(ops) {
  let t = [], steps = 0
  const run = (from, to) => {
    for (let i = from; i < to; i++) {
      if (++steps > STEP_LIMIT) throw new Error('the program never ends')
      const { op, args } = ops[i]
      switch (op) {
        case 'put': t.push(...args.map(byte)); break
        case 'count': t.push(byte(t.length)); break
        case 'take': t = t.slice(0, byte(args[0])); break
        case 'drop': t = t.slice(byte(args[0])); break
        case 'rev': t.reverse(); break
        case 'dup': t.push(...t); break
        case 'stream': for (const x of args.map(byte)) { if (t.length && x <= t[t.length - 1]) throw new Error('a stream must rise'); t.push(x) } break
        case 'filter': t = t.filter(x => (args[0] === '<' ? x < args[1] : x > args[1])); break
        case 'flush': t = []; break
        case 'write': { const i = byte(args[0]); if (i >= t.length) throw new Error(`nothing at index ${i} to write`); t[i] = byte(args[1]); break }
        case 'add': t = t.map(x => byte(x + args[0])); break
        case 'set': t = t.map(() => byte(args[0])); break
        case 'grow': t = Array(Math.min(16, byte(args[0]))).fill(t).flat(); break
        case 'sum': t.push(byte(t.reduce((a, x) => a + x, 0))); break
        case 'peak': if (!t.length) throw new Error('no peak on an empty tape'); t.push(Math.max(...t)); break
        case 'spike': { const v = byte(args[0]); if (t.some(x => x >= v)) throw new Error('a spike must be the largest'); t.push(v); break }
        case 'cut': if (!t.length) throw new Error('nothing to cut'); t.splice(t.indexOf(Math.max(...t)), 1); break
        case 'raw': t.push(...args.map(byte)); break
        case 'checksum': t.push(t.reduce((a, x) => a + x, 0) % 256); break
        case 'sort': t.sort((a, b) => a - b); break
        case 'cap': t = t.map(x => Math.min(x, byte(args[0]))); break
        case 'mod': if (!args[0]) throw new Error('mod 0'); t = t.map(x => x % byte(args[0])); break
        case 'mul': t = t.map(x => byte(x * args[0])); break
        case 'scale': if (!args[0]) throw new Error('scale 0'); t = t.map(x => Math.floor(x / args[0])); break
        case 'xor': t = t.map(x => x ^ byte(args[0])); break
        case 'peek': { const i = byte(args[0]); if (i >= t.length) throw new Error(`nothing at index ${i}`); t.push(t[i]); break }
        case 'loop': {
          let depth = 1, j = i + 1
          while (j < to && depth) { if (ops[j].op === 'loop') depth++; if (ops[j].op === 'end') depth--; j++ }
          for (let k = 0; k < Math.min(16, byte(args[0])); k++) run(i + 1, j - 1)
          i = j - 1
          break
        }
        case 'end': break
      }
      if (t.length > TAPE_LIMIT) throw new Error('the tape is full')
    }
  }
  try { run(0, ops.length) } catch (e) { return { error: String(e.message ?? e) } }
  return { tape: t }
}

/** The glyph strip the player sees without the DECODER: one rune per op, numbers as bytes in hex. */
export const glyphs = ops => ops.map(({ op, args }) => OPS[op].glyph + (args.length ? ' ' + args.map(a => (typeof a === 'string' ? a : a.toString(16).padStart(2, '0'))).join(' ') : '')).join('  ')

/** The JavaScript the program means (shown with the DECODER). */
export const toJavaScript = ops => ['let t = []', ...ops.map(({ op, args }) => OPS[op].js(args)), 'return t'].join('\n')

// ---------- what each move must emit (the prototype's five; the table grows from here) ----------

/** A spec: `ops` (the ops this move is written with: the prompt names only these), `noun` (what the type emits, shown
 *  without the DECODER), the turn's `key` (a number the program must work in: the one thing that changes turn to turn, like the
 *  foe's bytes did), `want(key)` (the words), `ok(tape, key)` (the check), `example` (a program that passes for its
 *  own key, shown in the prompt so the shape is clear). */
const pick = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1))
export const EMIT = {
  // Normal — a file: it announces its own length and carries the key
  PING: { ops: ['put'], noun: 'a file', type: 'Normal', key: r => pick(r, 10, 199), want: k => `a file: 4 to 8 numbers whose first number is how many numbers follow it, and ${k} is one of them`,
    example: { key: 77, program: 'put 4\nput 42 13 140 77' },
    ok: (t, k) => t.length >= 5 && t.length <= 9 && t[0] === t.length - 1 && t.slice(1).includes(k) },
  // Water — a stream: it only ever rises, and it passes through the key
  FLUSH: { ops: ['stream'], noun: 'a stream', type: 'Water', key: r => pick(r, 10, 99), want: k => `a stream: 4 to 8 numbers, each greater than the last, all under 100, one of them ${k}`,
    example: { key: 40, program: 'stream 3 9 40 88' },
    ok: (t, k) => t.length >= 4 && t.length <= 8 && t.every((x, i) => x < 100 && (i === 0 || x > t[i - 1])) && t.includes(k) },
  // Fire — a write: the key burned over and over
  BURNDISC: { ops: ['put', 'set'], noun: 'a write', type: 'Fire', key: r => pick(r, 200, 255), want: k => `a write: 4 to 8 copies of ${k}`,
    example: { key: 230, program: 'put 1 1 1 1\nset 230' },
    ok: (t, k) => t.length >= 4 && t.length <= 8 && t.every(x => x === k) },
  // Rock — raw bytes with a checksum at the end, the key among them
  BOOT: { ops: ['raw', 'checksum'], noun: 'raw bytes', type: 'Rock', key: r => pick(r, 16, 255), want: k => `raw bytes: 4 to 8 numbers with ${k} (hex ${k.toString(16)}) among them, then their sum mod 256 as the last number`,
    example: { key: 126, program: 'raw ff 0a 7e 10\nchecksum' },
    ok: (t, k) => t.length >= 5 && t.length <= 9 && t.slice(0, -1).includes(k) && t[t.length - 1] === t.slice(0, -1).reduce((a, x) => a + x, 0) % 256 },
  // Electric — a signal: quiet, then one spike of exactly the key
  SURGE: { ops: ['put', 'spike'], noun: 'a signal', type: 'Electric', key: r => pick(r, 150, 255), want: k => `a signal: 3 to 7 numbers under 40, then one spike of exactly ${k} at the end`,
    example: { key: 200, program: 'put 5 12 8\nspike 200' },
    ok: (t, k) => t.length >= 4 && t.length <= 8 && t.slice(0, -1).every(x => x < 40) && t[t.length - 1] === k },
}

// ---------- the prompt and the judge ----------

const OP_HELP = {
  put: 'append numbers', count: 'append how many numbers there are', take: 'keep the first n', drop: 'drop the first n', rev: 'reverse', dup: 'repeat the tape',
  stream: 'append numbers, each greater than the last', filter: 'keep numbers < n or > n', flush: 'empty the tape',
  write: 'set the number at index i to v', add: 'add n to every number', set: 'make every number v',
  grow: 'repeat the tape n times', sum: 'append the total', peak: 'append the largest', spike: 'append v, which must be the largest', cut: 'remove the largest',
  raw: 'append hex bytes', checksum: 'append the total mod 256', sort: 'sort', cap: 'cap every number at n', mod: 'every number mod n', mul: 'multiply every number by n',
  scale: 'divide every number by n', xor: 'xor every number with n', peek: 'append the number at index i', loop: 'repeat the lines up to end n times', end: 'end of loop',
}
const opLine = k => `${k}${OPS[k].args > 0 ? ' n'.repeat(OPS[k].args) : OPS[k].args < 0 ? ' n…' : ''}`

/** The prompt for one rune move. No foe data: the Pokémon only emits. `style` (measured 2026-10-12, models/runes-exp):
 *  'lean' (default) names only the move's own ops and the shape to change; 'full' lists the whole language. */
export function runePrompt({ self, target, move, key, budget, hot = '', style = 'lean' }) {
  const spec = EMIT[move.name]
  const lines = spec.example.program.split('\n').length
  if (style === 'full') {
    const system = [`You are ${self.name}, a level ${self.level} Pokémon. You fight with a short program: a line of ops that leaves numbers on a tape.`,
      'Ops (one per line, numbers after): ' + OP_NAMES.map(opLine).join(' · ') + '.',
      'put/stream/raw append numbers; stream must rise; spike must be the largest; raw numbers are hex; loop n … end repeats. Numbers are bytes (0–255).',
      'Reply with only the program, one op per line. No words.'].join('\n')
    const user = [`Move: ${move.name} (${spec.type}). Sing ${spec.want(key)}.`,
      `Example that works for ${spec.example.key}:\n${spec.example.program}`,
      `At most ${budget} characters.`,
      ...(hot ? [`Your trainer's note: ${hot}`] : []),
      `Target: ${target.name}, level ${target.level}.`].join('\n')
    return { system, user }
  }
  const system = [`You are ${self.name}, a level ${self.level} Pokémon. You attack with a short program: one op per line, numbers after it. Numbers are bytes (0–255).`,
    `Reply with the program only: exactly ${lines} line${lines === 1 ? '' : 's'}, no words, nothing after it.`].join('\n')
  const user = [`Move: ${move.name} (${spec.type}). Sing ${spec.want(key)}.`,
    'Ops: ' + spec.ops.map(k => `${opLine(k)} (${OP_HELP[k]})`).join('; ') + '.',
    `This shape works for ${spec.example.key}; change the numbers so it works for ${key}:\n${spec.example.program}`,
    ...(hot ? [`Your trainer's note: ${hot}`] : []),
    `Target: ${target.name}, level ${target.level}.`].join('\n')
  return { system, user }
}

/** Hit or miss for a rune move. reason: 'no code' | 'crashed' | 'wrong answer' | 'over budget' (the ROM's four). */
export function judgeRunes({ move, text, key, budget }) {
  const spec = EMIT[move.name]
  if (!spec) return { hit: false, reason: 'no code' }
  const body = String(text ?? '').replace(/```[a-z]*/gi, '').trim()
  if (!body) return { hit: false, reason: 'no code' }
  if (body.length > budget) return { hit: false, reason: 'over budget' }
  const parsed = parseRunes(body)
  if (parsed.error) return { hit: false, reason: 'crashed', error: parsed.error }
  const ran = runTape(parsed.ops)
  if (ran.error) return { hit: false, reason: 'crashed', error: ran.error, ops: parsed.ops }
  if (!spec.ok(ran.tape, key)) return { hit: false, reason: 'wrong answer', got: ran.tape, want: spec.want(key), ops: parsed.ops }
  return { hit: true, got: ran.tape, ops: parsed.ops }
}

/** Is this move written in runes (has an emit spec) in this build? */
export const usesRunes = move => Object.hasOwn(EMIT, move?.name ?? '')
export { formatOf }
