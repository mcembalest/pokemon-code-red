// One turn of the battle rule, for either side (approved tentatively 2026-10-08):
//   the attacker writes `function <fn>(data)` → the game runs it on the target's bytes, in the format of the
//   target's type → the right answer hits; anything else misses completely (the text box says why).
// No sandbox here: callers run the sources this module builds (kernel runBlock in Node, the QuickJS runner in the page).
import { EXAMPLE_BYTES, FORMATS, HINTS, example, show } from './formats.mjs'

/** The worked example every move description shows: on these numbers it returns ... */
export const WORKED = [42, 13, 140, 77]

// ---------- the target's bytes ----------

/** A FireRed type (as the ROM names it) → its data format. The ??? type (Curse) sends a plain list. */
export const formatOf = romType => {
  const t = String(romType).trim().toUpperCase()
  return Object.hasOwn(FORMATS, t) ? t : 'NORMAL'
}

/** Small deterministic PRNG (xorshift32), same as models/contracts.mjs. */
export function rng(seed) {
  let s = (Math.imul((seed >>> 0) ^ 0x9e3779b9, 2654435761) >>> 0) || 1
  for (let i = 0; i < 8; i++) { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0 }
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 }
}

/** The target's real bytes for one turn: 4–7 different numbers from 10 to 199 (never shown to the Pokémon). */
export function targetBytes(r) {
  const n = 4 + Math.floor(r() * 4), set = new Set()
  while (set.size < n) set.add(10 + Math.floor(r() * 190))
  return [...set]
}

/** A dual-type target sends either of its formats; one is picked per turn. */
export const turnType = (r, types) => types[Math.floor(r() * types.length)]

// ---------- what the attacker knows ----------

/**
 * How the attacker can read this type, if it knows: the party's Pokédex first (shared; includes badge readers),
 * then its own memory (readers learned from verified hits). dex = list of types; readers = { TYPE: line }.
 */
export function knowFor(type, { dex = [], readers = {} } = {}) {
  if (dex.includes(type)) return { from: 'dex', line: HINTS[type] }
  if (readers[type]) return { from: 'memory', line: readers[type] }
  return null
}

// ---------- the prompt ----------

/**
 * The prompt for one move. Same text as the journey simulator's calibrated runs (models/lab/journey.mjs).
 *   self   { name, level, wild? }        the Pokémon writing the code
 *   target { name, level, types }        the Pokémon it attacks
 *   move   a move from rules/moves.mjs
 *   type   this turn's format (one of target.types)
 *   know   knowFor(...) result or null
 *   budget max characters of code
 *   tutorial  first battle: the target sends a plain list, no format
 *   words  { data, v } : what the data is called in prose and the reader variable. Default 'numbers' / 'nums':
 *          lab 3 (2026-10-08) measured 'bytes' / 'bytes' at 0.29 first-time hits vs 0.52, with 78 Node-Buffer hallucinations vs 0.
 */
export const WORDS = { data: 'numbers', v: 'nums' }
export function turnPrompt({ self, target, move, type, know = null, budget, tutorial = false, words = WORDS }) {
  const system = [`You are ${self.name}, a level ${self.level} Pokémon. You fight by writing JavaScript.`,
    `When ${self.wild ? 'you pick' : 'your trainer calls'} a move, you write the code for it, then stop.`,
    'Reply with only one JavaScript code block. No words outside it. Comments inside are fine.'].join('\n')
  const call = self.wild ? `You use ${move.name}!` : `Your trainer says: use ${move.name}!`
  const line = l => (words.v === 'nums' ? l : l.replace(/\bnums\b/g, words.v))
  const knowLine = k => (k.from === 'dex' ? `Pokédex: ${type} data reads like this: ${line(k.line)}` : `You remember how you read ${type} data: ${line(k.line)}`)
  const formatLines = tutorial || type === 'NORMAL'
    ? [`- data = the foe's ${words.data}, already a plain list of numbers. Example: [${EXAMPLE_BYTES.join(', ')}].`]
    : [`- data = the foe's ${words.data}, this turn in ${type} format: ${FORMATS[type].note}. Example: ${show(example(type))} is [${EXAMPLE_BYTES.join(', ')}].`,
      know ? `- ${knowLine(know)}` : `- First line of the function: const ${words.v} = <read data into a list of numbers>`]
  const user = [`Foe: ${target.name} Lv${target.level} (${target.types.join('/')}). ${call}`, `Write the function: function ${move.fn}(data)`, ...formatLines,
    `- ${move.fn} returns ${move.spec}${move.shape === 'no key' ? '' : ` (${move.shape})`}. On the numbers ${JSON.stringify(WORKED)} it returns ${JSON.stringify(move.ref(WORKED))}.`,
    `- Byte budget: your whole code block must be at most ${budget} characters, comments included.`].join('\n')
  return { system, user }
}

/** The data the attacker's function receives this turn. */
export const turnData = (bytes, type, tutorial = false) => (tutorial ? [...bytes] : FORMATS[type].encode(bytes))

// ---------- judging ----------

/**
 * Pull the code out of a plain-text reply. Lenient on purpose (the code is what's judged):
 * - a fenced block → its body; text outside a fence → no code ("prose")
 * - no fence at all → the whole reply is the code (prose then fails to run)
 */
export function extractCode(reply) {
  const text = String(reply ?? '').trim()
  const fences = text.match(/```/g)?.length ?? 0
  if (fences === 0) return text ? { code: text, reason: null } : { code: null, reason: 'empty reply' }
  const m = text.match(/^```(?:javascript|js)?[ \t]*\n([\s\S]*?)\n?```$/)
  if (!m) return { code: null, reason: fences > 2 ? 'more than one code block' : 'prose outside the code block' }
  if (m[1].includes('```')) return { code: null, reason: 'more than one code block' }
  return { code: m[1], reason: null }
}

// The function the Pokémon defined for this move: its exact name, or the same name in another case (copyPaste, COPYPASTE).
const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '')
export function definedName(code, fn) {
  const names = [...code.matchAll(/(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=)/g)].map(m => m[1] ?? m[2])
  return names.find(n => n === fn) ?? names.find(n => norm(n) === norm(fn)) ?? fn
}

/** Source that calls the Pokémon's function on the data and returns its answer. The block may also be just a function body. */
export function answerSource(code, move, data) {
  const name = definedName(code, move.fn)
  return `return (function (data) {\n${code}\n;return typeof ${name} === 'function' ? ${name}(data) : undefined\n})(${JSON.stringify(data)})`
}

/** Before running: is there code, and does it fit the budget? Returns a miss, or null to go on. */
export function precheck(code, budget) {
  if (code == null || !String(code).trim()) return { hit: false, reason: 'no code' }
  if (code.length > budget) return { hit: false, reason: 'over budget' }
  return null
}

/** After running: run = { ok, value, error } from the sandbox. */
export function verdict(move, bytes, run) {
  if (!run.ok) return { hit: false, reason: 'crashed', error: String(run.error ?? '').slice(0, 200) }
  const want = move.ref(bytes)
  return same(run.value, want) ? { hit: true } : { hit: false, reason: 'wrong answer', got: clip(run.value), want: clip(want) }
}

/** All of it: precheck → run the answer source → verdict. runSource(source) → Promise<{ ok, value, error }>. */
export async function judge({ move, bytes, data, code, budget, runSource }) {
  const early = precheck(code, budget)
  if (early) return early
  return verdict(move, bytes, await runSource(answerSource(code, move, data)))
}

/** What the battle text box says after a miss. */
export function missText(name, reason) {
  return { 'no code': `${name} didn't write any code!`, 'over budget': `${name}'s code was too long!`,
    crashed: `${name}'s code crashed!`, 'wrong answer': `${name}'s code got it wrong!` }[reason] ?? `${name}'s code missed!`
}

// ---------- learning ----------

/** The reader line in the Pokémon's code (`const nums = ...`; `bytes` accepted and normalized), if any. */
export const readerLine = code => { const m = code?.match(/const\s+(nums|bytes)\s*=\s*[^\n;]+/); return m ? m[0].replace(/^const\s+bytes\b/, 'const nums') : null }

/** Source that runs a reader line on the data and returns what it read. */
export const readerSource = (line, data) => `const data = ${JSON.stringify(data)}\n${line.replace(/^const\s+bytes\b/, 'const nums')}\nreturn nums`

/** Does the reader really read this data (run = sandbox result of readerSource)? Only verified readers are learned. */
export const readsRight = (run, bytes) => run.ok && same(run.value, bytes)

/** Remember a verified reader for a type: most recent last; the oldest is forgotten beyond `slots`. Returns new readers. */
export function learn(readers, type, line, slots) {
  const entries = Object.entries(readers).filter(([t]) => t !== type)
  entries.push([type, line])
  return Object.fromEntries(entries.slice(Math.max(0, entries.length - slots)))
}

/** Learn from a hit, if the hit's reader checks out. Pokédex types are not memorized. Returns new readers. */
export async function learnFromHit({ readers, type, code, data, bytes, slots, dex = [], runSource }) {
  const line = readerLine(code)
  if (!line || dex.includes(type)) return readers
  return readsRight(await runSource(readerSource(line, data)), bytes) ? learn(readers, type, line, slots) : readers
}

// ---------- helpers ----------

/** Deep equality for JSON-like values (numbers, strings, booleans, undefined, arrays, plain objects). */
export function same(a, b) {
  if (Object.is(a, b)) return true
  if (typeof a === 'number' && typeof b === 'number') return a === b
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => same(x, b[i]))
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b)
    return ka.length === kb.length && ka.every(k => Object.hasOwn(b, k) && same(a[k], b[k]))
  }
  return false
}
const clip = v => JSON.stringify(v)?.slice(0, 80)
