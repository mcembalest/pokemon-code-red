// A Pokémon's memory is code (owner, 2026-10-11): three kinds of bytes ride into every prompt, and all cost bytes
// from the turn's budget.
//   working memory   helpers it chose to keep during this battle: anything its code defines with a name starting
//                    `my` (function myRead(data){…}, const myMax = …). Gone when the battle ends.
//   long-term memory helpers kept between battles. When a battle ends the Pokémon consolidates: it sees what it
//                    carries and rewrites its long-term memory to fit its cap, which grows with level. It may lose
//                    things (owner: "consolidation can lose things yes"). Only code that compiles is kept.
//   your note        the text the trainer pins in the PokÉEG (hot memory).
// Both kinds of helpers are defined before the move's code runs, so it can call them. Foes carry none (pure instinct).
// No parser dependency: a small scanner that skips strings and comments finds the definitions.

/** Long-term memory cap in characters: 105 at level 5, 180 at 20, 280 at 40 (a level-5 Pokémon can keep about one reader). */
export const MEMORY = { capBase: 80, capPerLevel: 5, workShare: 0.5 }
export const libCap = level => MEMORY.capBase + MEMORY.capPerLevel * Math.max(1, level)
/** Working memory may take at most this share of the turn's budget; the oldest helpers drop first. */
export const workCap = budget => Math.floor(budget * MEMORY.workShare)

/** The code with strings, template literals and comments blanked out (same length), so braces inside them don't count. */
function mask(code) {
  const out = code.split('')
  let i = 0
  const blank = (a, b) => { for (let k = a; k < b && k < out.length; k++) if (out[k] !== '\n') out[k] = ' ' }
  while (i < code.length) {
    const c = code[i], d = code[i + 1]
    if (c === '/' && d === '/') { const e = code.indexOf('\n', i); const end = e < 0 ? code.length : e; blank(i, end); i = end }
    else if (c === '/' && d === '*') { const e = code.indexOf('*/', i + 2); const end = e < 0 ? code.length : e + 2; blank(i, end); i = end }
    else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1
      while (j < code.length && code[j] !== c) { if (code[j] === '\\') j++; if (c !== '`' && code[j] === '\n') break; j++ }
      blank(i + 1, j); i = j + 1
    } else i++
  }
  return out.join('')
}

const OPEN = '([{', CLOSE = ')]}'
/** End (exclusive) of the bracket group that opens at `at` in masked code, or -1. */
function closeOf(m, at) {
  let depth = 0
  for (let i = at; i < m.length; i++) {
    if (OPEN.includes(m[i])) depth++
    else if (CLOSE.includes(m[i])) { depth--; if (depth === 0) return i + 1 }
  }
  return -1
}

/** End (exclusive) of a `const x = …` statement starting at `at`: a `;` or a line break at depth 0 that ends the expression. */
function statementEnd(m, at) {
  let depth = 0
  for (let i = at; i < m.length; i++) {
    const c = m[i]
    if (OPEN.includes(c)) depth++
    else if (CLOSE.includes(c)) { depth--; if (depth < 0) return i }
    else if (depth === 0 && c === ';') return i + 1
    else if (depth === 0 && c === '\n') {
      const before = m.slice(at, i).trimEnd(), after = m.slice(i + 1).trimStart()
      if (!/[=>(,+\-*/?:&|.]$/.test(before) && !/^[.?:+\-*/&|)]/.test(after)) return i
    }
  }
  return m.length
}

/** The `my…` helpers a piece of code defines (at any depth), in order: [{ name, src }]. A later one of the same name wins. */
export function extractHelpers(code) {
  if (!code) return []
  const m = mask(String(code)), found = new Map()
  const re = /\b(?:async\s+)?function\s+(my[A-Za-z0-9_$]*)\s*\(|\b(?:const|let|var)\s+(my[A-Za-z0-9_$]*)\s*=/g
  for (let hit; (hit = re.exec(m));) {
    const start = hit.index
    let end
    if (hit[1]) { const brace = m.indexOf('{', closeOf(m, m.indexOf('(', start))); end = brace < 0 ? -1 : closeOf(m, brace) }
    else end = statementEnd(m, start)
    if (end <= start) continue
    let src = String(code).slice(start, end).trim()
    if (hit[2]) src = src.replace(/^(?:let|var)\b/, 'const').replace(/;?$/, ';')
    found.delete(hit[1] ?? hit[2])
    found.set(hit[1] ?? hit[2], src)
    re.lastIndex = end
  }
  return [...found].map(([name, src]) => ({ name, src }))
}

/** Old helpers updated by new ones (a redefinition replaces the old and moves to the end: most recent last). */
export function mergeHelpers(old, more) {
  const map = new Map(old.map(h => [h.name, h.src]))
  for (const h of more) { map.delete(h.name); map.set(h.name, h.src) }
  return [...map].map(([name, src]) => ({ name, src }))
}

export const helpersSource = helpers => helpers.map(h => h.src).join('\n')
export const helpersSize = helpers => helpersSource(helpers).length

/** Keep the most recent helpers that fit in `cap` characters (the oldest drop first). */
export function fitHelpers(helpers, cap) {
  const out = []
  for (let i = helpers.length - 1; i >= 0; i--) if (helpersSize([helpers[i], ...out]) <= cap) out.unshift(helpers[i])
  return out
}

/** Readers learned under the old rule become long-term helpers (one-time migration of a save). */
export const helpersFromReaders = readers => Object.entries(readers ?? {}).map(([type, line]) => {
  const name = `myRead${type[0]}${type.slice(1).toLowerCase()}`
  return { name, src: `function ${name}(data){${String(line).replace(/^const\s+bytes\b/, 'const nums')};return nums}` }
})

/** Source that checks helpers compile on their own: returns the names that are functions or values. */
export const compileSource = helpers => `${helpersSource(helpers)}\nreturn [${helpers.map(h => `typeof ${h.name} !== 'undefined' && '${h.name}'`).join(',')}].filter(Boolean)`

/** The end-of-battle prompt: rewrite your long-term memory to fit. */
export function consolidatePrompt({ self, lib, work, cap }) {
  const all = helpersSource(mergeHelpers(lib, work))
  const system = [`You are ${self.name}, a level ${self.level} Pokémon. You fight by writing JavaScript.`,
    'Reply with only one JavaScript code block. No words outside it.'].join('\n')
  const user = [`The battle is over. You can keep at most ${cap} characters of helpers for future battles: your long-term memory.`,
    all ? `What you carry now (your long-term memory, then what you kept this battle):\n${all}` : 'You carry nothing yet.',
    `Write the helpers you want to keep: only functions or consts whose names start with my, at most ${cap} characters in all.`,
    'Every character you keep is a character less for your moves. Keep what will help you read data and fight next time; drop the rest.'].join('\n')
  return { system, user }
}

/** What the prompt tells a Pokémon about its memory this turn. */
export function memoryLines({ lib = [], work = [] }) {
  const all = mergeHelpers(lib, work)
  return [
    ...(all.length ? [`- Your memory (already defined, call them by name):\n${helpersSource(all)}`] : []),
    '- To keep a helper for the rest of this battle, define it outside your function with a name starting with my (function myRead(data){…}). What you carry costs bytes from your budget.',
  ]
}
