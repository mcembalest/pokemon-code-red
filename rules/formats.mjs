// Type = data format (approved tentatively 2026-10-08): each foe type hands over its bytes in its own format.
// encode(bytes) → what the Pokémon's code receives. decode is the reference parse (for tests).
// note = what the Pokémon may be told; example = the same format with other numbers.

const hex = n => n.toString(16).padStart(2, '0')

export const FORMATS = {
  NORMAL: { note: 'a plain list of numbers', encode: b => [...b], decode: d => d },
  FLYING: { note: 'JSON text (cloud data)', encode: b => JSON.stringify(b), decode: d => JSON.parse(d) },
  WATER: { note: 'text with one number per line (a stream)', encode: b => b.join('\n'), decode: d => d.split('\n').map(Number) },
  GRASS: { note: "a log line of 'byte=<number>' entries separated by spaces, e.g. 'byte=42 byte=13'", encode: b => b.map(x => `byte=${x}`).join(' '), decode: d => d.split(' ').map(s => Number(s.split('=')[1])) },
  ROCK: { note: 'a hex dump: two hex digits per byte, separated by spaces (hardware)', encode: b => b.map(hex).join(' '), decode: d => d.split(' ').map(h => parseInt(h, 16)) },
  ELECTRIC: { note: 'binary: each byte written in base 2, separated by spaces (power on/off)', encode: b => b.map(x => x.toString(2)).join(' '), decode: d => d.split(' ').map(s => parseInt(s, 2)) },
  GROUND: { note: 'CSV text: numbers separated by commas (an on-prem spreadsheet)', encode: b => b.join(','), decode: d => d.split(',').map(Number) },
  FIRE: { note: 'a write log: records { at: <position>, value: <number> } in the order they were written, not in position order', encode: b => shuffled(b).map(i => ({ at: i, value: b[i] })), decode: d => [...d].sort((x, y) => x.at - y.at).map(r => r.value) },
  POISON: { note: "text: the numbers are separated by the letter x, with an x at both ends, e.g. 'x42x13x140x' (malware hides them)", encode: b => `x${b.join('x')}x`, decode: d => d.split('x').filter(Boolean).map(Number) },
  BUG: { note: 'a buggy copy: some numbers appear twice in a row; keep one of each (bugs duplicate data)', encode: b => dup(b), decode: d => d.filter((x, i) => i === 0 || x !== d[i - 1]) },
  PSYCHIC: { note: "an object whose keys are 'b' + position ('b0', 'b1', …), in a jumbled order (it reads minds, not lists)", encode: b => Object.fromEntries(shuffled(b).map(i => ['b' + i, b[i]])), decode: d => Object.keys(d).sort((x, y) => x.slice(1) - y.slice(1)).map(k => d[k]) },
  FIGHTING: { note: 'a list of [a, b] pairs, one pair per byte; the byte is a + b (raw compute)', encode: b => b.map(x => { const a = Math.floor(x / 2) + (x % 7); return [a, x - a] }), decode: d => d.map(([a, c]) => a + c) },
  STEEL: { note: 'encrypted: each number XOR 255 gives the byte', encode: b => b.map(x => x ^ 255), decode: d => d.map(x => x ^ 255) },
  ICE: { note: 'a list of snapshots { v: <version>, bytes: [...] }; the latest (last) one holds the real numbers', encode: b => [{ v: 1, bytes: b.map(x => (x * 7) % 190 + 10) }, { v: 2, bytes: [...b] }], decode: d => [...d.at(-1).bytes] },
  GHOST: { note: 'invisible: a string whose character codes are the numbers (spyware hides in plain sight)', encode: b => String.fromCharCode(...b), decode: d => [...d].map(c => c.charCodeAt(0)) },
  DRAGON: { note: 'kernel memory: one hex string with no separators, two hex digits per byte', encode: b => b.map(hex).join(''), decode: d => (d.match(/../g) ?? []).map(h => parseInt(h, 16)) },
  DARK: { note: "a signed token: three parts separated by '.', the numbers are the middle part, separated by commas, e.g. 'v1.42,13,140.ok'", encode: b => `v1.${b.join(',')}.ok`, decode: d => d.split('.')[1].split(',').map(Number) },
}

/** a buggy copy: every other number (from the second) is written twice in a row */
function dup(b) {
  return b.flatMap((x, i) => (i % 2 === 1 ? [x, x] : [x]))
}
/** positions in a fixed jumbled order: odd positions descending, then even ascending */
function shuffled(b) {
  const keys = b.map((_, i) => i)
  return [...keys.filter(i => i % 2 === 1).reverse(), ...keys.filter(i => i % 2 === 0)]
}
/** The Pokédex reader per type: one line of JavaScript that reads this type's data into a list of numbers.
 *  The variable is `nums`: lab 3 (2026-10-08) showed `bytes` makes Llama reach for Node Buffers (first-time hits 0.29 → 0.52). */
export const HINTS = {
  NORMAL: 'const nums = data', FLYING: 'const nums = JSON.parse(data)', WATER: "const nums = data.split('\\n').map(Number)",
  GRASS: "const nums = data.split(' ').map(s => Number(s.split('=')[1]))", ROCK: "const nums = data.split(' ').map(h => parseInt(h, 16))",
  ELECTRIC: "const nums = data.split(' ').map(s => parseInt(s, 2))", GROUND: "const nums = data.split(',').map(Number)",
  FIRE: 'const nums = [...data].sort((a, b) => a.at - b.at).map(r => r.value)', POISON: "const nums = data.split('x').filter(s => s).map(Number)", BUG: 'const nums = data.filter((x, i) => i === 0 || x !== data[i - 1])',
  PSYCHIC: 'const nums = Object.keys(data).sort((a, b) => a.slice(1) - b.slice(1)).map(k => data[k])', FIGHTING: 'const nums = data.map(([a, b]) => a + b)', STEEL: 'const nums = data.map(x => x ^ 255)',
  ICE: 'const nums = data.at(-1).bytes', GHOST: 'const nums = [...data].map(c => c.charCodeAt(0))', DRAGON: 'const nums = data.match(/../g).map(h => parseInt(h, 16))',
  DARK: "const nums = data.split('.')[1].split(',').map(Number)",
}

export const EXAMPLE_BYTES = [42, 13, 140]
export const example = type => FORMATS[type].encode(EXAMPLE_BYTES)
export const show = v => JSON.stringify(v)
