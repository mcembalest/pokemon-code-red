// Foe types before Misty: what the code must clean up before computing the move (draft 2026-10-07).
// Concepts from notes/types.md. Each type: a rule the Pokémon is told (or remembers), a reference
// cleanup, and a generator that adds exactly that kind of junk to clean bytes.
// Clean bytes are 10..199 and all different, so every kind of junk is recognizable.
// Dual types: the first type's rule runs first. Generation adds the second type's junk, then the first's.

const pick = (r, a) => a[Math.floor(r() * a.length)]
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1))
const insertAt = (r, list, value) => { const out = [...list]; out.splice(int(r, 0, out.length), 0, value); return out }
const sameKind = (list, n) => (typeof list[0] === 'string' ? String(n) : n) // FLYING turns bytes into text

export const TYPES = {
  NORMAL: { concept: 'files', rule: 'nothing to clean', why: 'files: nothing to clean', clean: b => b, junk: (r, b) => b },
  FIRE: { concept: 'writes', rule: 'drop every byte over 200', why: 'bytes over 200 are still being written', clean: b => b.filter(x => x <= 200),
    junk: (r, b) => { let o = b; for (let k = int(r, 1, 2); k--;) o = insertAt(r, o, sameKind(b, int(r, 201, 254))); return o } },
  WATER: { concept: 'wipe', rule: 'drop every 0', why: 'wiped bytes read 0', clean: b => b.filter(x => x != 0),
    junk: (r, b) => { let o = b; for (let k = int(r, 1, 2); k--;) o = insertAt(r, o, sameKind(b, 0)); return o } },
  GRASS: { concept: 'sprawl', rule: 'drop every byte under 10', why: 'leftover fragments are under 10', clean: b => b.filter(x => x >= 10),
    junk: (r, b) => { let o = b; for (let k = int(r, 1, 2); k--;) o = insertAt(r, o, sameKind(b, int(r, 1, 9))); return o } },
  ELECTRIC: { concept: 'power', rule: 'drop the largest byte (only that one)', why: 'the largest byte is a power spike', clean: b => { const i = b.map(Number).indexOf(Math.max(...b.map(Number))); return b.filter((_, j) => j !== i) },
    junk: (r, b) => insertAt(r, b, sameKind(b, Math.max(...b.map(Number)) + int(r, 1, 50))) },
  FIGHTING: { concept: 'raw compute', rule: 'keep only the first 5 bytes', why: 'everything after the first 5 is flooding', clean: b => b.slice(0, 5), base: 5,
    junk: (r, b) => [...b, ...Array.from({ length: int(r, 2, 4) }, () => sameKind(b, int(r, 10, 199)))] },
  POISON: { concept: 'malware', rule: 'drop every negative byte', why: 'infected bytes are negative', clean: b => b.filter(x => x >= 0),
    junk: (r, b) => { let o = b; for (let k = int(r, 1, 2); k--;) o = insertAt(r, o, sameKind(b, -int(r, 1, 99))); return o } },
  GROUND: { concept: 'physical', rule: 'drop the first byte', why: 'the first byte is a hardware header', clean: b => b.slice(1),
    junk: (r, b) => [sameKind(b, int(r, 10, 199)), ...b] },
  FLYING: { concept: 'cloud', rule: 'the bytes are text: turn each into a number', why: 'cloud data arrives as text', clean: b => b.map(Number),
    junk: (r, b) => b.map(String) },
  PSYCHIC: { concept: 'detection', rule: 'reverse the bytes', why: 'it sees you coming: bytes arrive reversed', clean: b => [...b].reverse(),
    junk: (r, b) => [...b].reverse() },
  BUG: { concept: 'bugs', rule: 'drop repeats: keep only the first of each value', why: 'bugs duplicate bytes', clean: b => [...new Set(b)],
    junk: (r, b) => { let o = b; for (let k = int(r, 1, 2); k--;) { const v = pick(r, b); const at = o.indexOf(v); const out = [...o]; out.splice(int(r, at + 1, out.length), 0, v); o = out } return o } },
  ROCK: { concept: 'hardware', rule: 'drop every 255', why: 'burned-out cells read 255', clean: b => b.filter(x => x != 255),
    junk: (r, b) => { let o = b; for (let k = int(r, 1, 2); k--;) o = insertAt(r, o, sameKind(b, 255)); return o } },
  STEEL: { concept: 'encryption', rule: 'subtract 100 from every byte', why: 'encrypted: every byte arrives with 100 added', clean: b => b.map(x => x - 100),
    junk: (r, b) => b.map(x => sameKind(b, Number(x) + 100)) },
}

/** Foes before Misty (types from the inventory). Levels are where you meet them. */
export const FOES = [
  ['RATTATA', ['NORMAL'], 2, 15], ['PIDGEY', ['NORMAL', 'FLYING'], 2, 13], ['SPEAROW', ['NORMAL', 'FLYING'], 3, 15],
  ['CATERPIE', ['BUG'], 3, 10], ['METAPOD', ['BUG'], 5, 11], ['WEEDLE', ['BUG', 'POISON'], 3, 11], ['KAKUNA', ['BUG', 'POISON'], 4, 11],
  ['PIKACHU', ['ELECTRIC'], 3, 5], ['MANKEY', ['FIGHTING'], 2, 18], ['MACHOP', ['FIGHTING'], 13, 17],
  ['GEODUDE', ['ROCK', 'GROUND'], 7, 15], ['ONIX', ['ROCK', 'GROUND'], 10, 17], ['SANDSHREW', ['GROUND'], 11, 14],
  ['ZUBAT', ['POISON', 'FLYING'], 7, 15], ['EKANS', ['POISON'], 6, 15], ['NIDORAN', ['POISON'], 6, 16],
  ['ODDISH', ['GRASS', 'POISON'], 11, 14], ['PARAS', ['BUG', 'GRASS'], 5, 12], ['BULBASAUR', ['GRASS', 'POISON'], 5, 18],
  ['CHARMANDER', ['FIRE'], 5, 18], ['SQUIRTLE', ['WATER'], 5, 18], ['STARYU', ['WATER'], 18, 18], ['STARMIE', ['WATER', 'PSYCHIC'], 21, 21],
  ['ABRA', ['PSYCHIC'], 8, 16], ['DROWZEE', ['PSYCHIC'], 17, 17], ['CLEFAIRY', ['NORMAL'], 8, 14], ['JIGGLYPUFF', ['NORMAL'], 3, 14],
  ['MAGNEMITE', ['ELECTRIC', 'STEEL'], 11, 11], ['VOLTORB', ['ELECTRIC'], 11, 12],
]

/** Clean bytes for one foe: 4..7 different values in 10..199 (FIGHTING: exactly 5). */
export function cleanBytes(r, types) {
  const n = types.some(t => TYPES[t].base) ? 5 : int(r, 4, 7)
  const set = new Set(); while (set.size < n) set.add(int(r, 10, 199))
  return [...set]
}

/** What scan() shows: clean bytes with the types' junk added (second type first, so the first type's rule peels first). */
export function dirty(r, types, clean) {
  let b = clean
  for (const t of [...types].reverse()) b = TYPES[t].junk(r, b)
  return b
}

export const cleanup = (types, bytes) => types.reduce((b, t) => TYPES[t].clean(b), bytes)
