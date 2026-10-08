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
  BUG: { note: 'lists nested inside lists, in order (bugs everywhere)', encode: b => nest(b), decode: d => d.flat(Infinity) },
  PSYCHIC: { note: "an object whose keys are 'b' + position ('b0', 'b1', …), in a jumbled order (it reads minds, not lists)", encode: b => Object.fromEntries(shuffled(b).map(i => ['b' + i, b[i]])), decode: d => Object.keys(d).sort((x, y) => x.slice(1) - y.slice(1)).map(k => d[k]) },
  FIGHTING: { note: 'a list of [a, b] pairs, one pair per byte; the byte is a + b (raw compute)', encode: b => b.map(x => { const a = Math.floor(x / 2) + (x % 7); return [a, x - a] }), decode: d => d.map(([a, c]) => a + c) },
  STEEL: { note: 'encrypted: each number XOR 255 gives the byte', encode: b => b.map(x => x ^ 255), decode: d => d.map(x => x ^ 255) },
}

function nest(b) {
  // deterministic irregular nesting: [a, [b, c], [[d]], e, ...]
  const out = []; let i = 0, k = 0
  while (i < b.length) {
    const shape = k++ % 3
    if (shape === 0) out.push(b[i++])
    else if (shape === 1) { out.push(b.slice(i, i + 2)); i += 2 }
    else out.push([[b[i++]]])
  }
  return out
}
/** positions in a fixed jumbled order: odd positions descending, then even ascending */
function shuffled(b) {
  const keys = b.map((_, i) => i)
  return [...keys.filter(i => i % 2 === 1).reverse(), ...keys.filter(i => i % 2 === 0)]
}
/** The Pokédex reader per type: one line of JavaScript that reads this type's data into a list of numbers. */
export const HINTS = {
  NORMAL: 'const bytes = data', FLYING: 'const bytes = JSON.parse(data)', WATER: "const bytes = data.split('\\n').map(Number)",
  GRASS: "const bytes = data.split(' ').map(s => Number(s.split('=')[1]))", ROCK: "const bytes = data.split(' ').map(h => parseInt(h, 16))",
  ELECTRIC: "const bytes = data.split(' ').map(s => parseInt(s, 2))", GROUND: "const bytes = data.split(',').map(Number)",
  FIRE: 'const bytes = [...data].sort((a, b) => a.at - b.at).map(r => r.value)', POISON: "const bytes = data.split('x').filter(s => s).map(Number)", BUG: 'const bytes = data.flat(Infinity)',
  PSYCHIC: 'const bytes = Object.keys(data).sort((a, b) => a.slice(1) - b.slice(1)).map(k => data[k])', FIGHTING: 'const bytes = data.map(([a, b]) => a + b)', STEEL: 'const bytes = data.map(x => x ^ 255)',
}

export const EXAMPLE_BYTES = [42, 13, 140]
export const example = type => FORMATS[type].encode(EXAMPLE_BYTES)
export const show = v => JSON.stringify(v)
