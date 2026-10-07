// "Type = data format": each foe type hands over its bytes in its own format (from notes/types.md concepts).
// encode(bytes) → what the Pokémon's code receives. decode is the reference parse (for tests).
// note = what the Pokémon may be told; example = the same format with other numbers.

const hex = n => n.toString(16).padStart(2, '0')

export const FORMATS = {
  NORMAL: { note: 'a plain list of numbers', encode: b => [...b], decode: d => d },
  FLYING: { note: 'JSON text (cloud data)', encode: b => JSON.stringify(b), decode: d => JSON.parse(d) },
  WATER: { note: 'text with one number per line (a stream)', encode: b => b.join('\n'), decode: d => d.split('\n').map(Number) },
  GRASS: { note: 'a log line: byte=<number> entries separated by spaces', encode: b => b.map(x => `byte=${x}`).join(' '), decode: d => d.split(' ').map(s => Number(s.split('=')[1])) },
  ROCK: { note: 'a hex dump: two hex digits per byte, separated by spaces (hardware)', encode: b => b.map(hex).join(' '), decode: d => d.split(' ').map(h => parseInt(h, 16)) },
  ELECTRIC: { note: 'binary: each byte written in base 2, separated by spaces (power on/off)', encode: b => b.map(x => x.toString(2)).join(' '), decode: d => d.split(' ').map(s => parseInt(s, 2)) },
  GROUND: { note: 'CSV text: numbers separated by commas (an on-prem spreadsheet)', encode: b => b.join(','), decode: d => d.split(',').map(Number) },
  FIRE: { note: 'a list of written records: { value: <number> }', encode: b => b.map(value => ({ value })), decode: d => d.map(r => r.value) },
  POISON: { note: 'text where the numbers hide between x marks (malware)', encode: b => `x${b.join('x')}x`, decode: d => d.split('x').filter(Boolean).map(Number) },
  BUG: { note: 'lists nested inside lists, in order (bugs everywhere)', encode: b => nest(b), decode: d => d.flat(Infinity) },
  PSYCHIC: { note: 'an object from position to number, keys out of order (it reads minds, not lists)', encode: b => shuffledObject(b), decode: d => Object.keys(d).sort((x, y) => x - y).map(k => d[k]) },
  FIGHTING: { note: 'a list of pairs; each byte is the sum of its pair (raw compute)', encode: b => b.map(x => { const a = Math.floor(x / 2) + (x % 7); return [a, x - a] }), decode: d => d.map(([a, c]) => a + c) },
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
function shuffledObject(b) {
  const keys = b.map((_, i) => i)
  const order = [...keys.filter(i => i % 2 === 1).reverse(), ...keys.filter(i => i % 2 === 0)]
  return Object.fromEntries(order.map(i => [String(i), b[i]]))
}

export const EXAMPLE_BYTES = [42, 13, 140]
export const example = type => FORMATS[type].encode(EXAMPLE_BYTES)
export const show = v => (typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v))
