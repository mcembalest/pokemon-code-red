// Code Red moves before Misty. One source of truth for names, specs and answers.
// The spine (owner, 2026-10-08): every Pokémon is a system, its type is the kind of system; a move is a program of the
// move's type run against the target's system. So every move's code belongs to its type's family (rules/families):
// Normal = file operations · Fire = writes · Water = flow · Grass = grow and gather · Electric = peaks · Ice = freeze ·
// Fighting = brute arithmetic · Poison = corrupt · Ground = ground (caps, floors, remainders) · Flying = distribute ·
// Psychic = inspect · Bug = introduce bugs · Rock = raw bytes · Ghost = peek at the hidden · Dragon = absolute ·
// Dark = pick by credential · Steel = cipher.
// FireRed keeps each move's type, power, accuracy, effect and animation; the name and the code change.
// The Pokémon writes `function <fn>(data)`; the game runs it on the target's data (in the target type's format,
// rules/formats.mjs); the right answer hits. `ref(b)` = the right answer from the target's bytes as a plain list.
// Indexes count from 0. No answer is null. Ties → the first one. "Rounded down" = Math.floor.
import { FIRERED } from './firered.mjs'

/**
 * Payload moves (owner, 2026-10-09): bytes are the universal medium, so a move may *make* bytes instead of answering —
 * a sound the GBA plays, a picture it draws. There is no single right answer: `check(value, bytes)` returns null for a
 * hit or why it missed. The foe's data still matters (the first number must be its count: the type's format must be read).
 * `ref` is the example shown in the prompt (a function of the foe's bytes), `kind` is what the GBA does with the bytes.
 */
const isBytes = (v, n) => Array.isArray(v) && v.length === n && v.every(x => Number.isInteger(x) && x >= 0 && x <= 255)
const crossings = v => { let n = 0, last = 0; for (const x of v) { const s = Math.sign(x - 128); if (s && last && s !== last) n++; if (s) last = s } return n }
export const PAYLOAD = {
  sound: { kind: 'sound', n: 400,
    check: (v, b) => !isBytes(v, v?.length) || v.length < 100 || v.length > 512 ? 'not 100 to 512 numbers from 0 to 255' : v[0] !== b.length ? `first number should be ${b.length}` : Math.max(...v) < 200 ? 'never loud (above 200)' : Math.min(...v.slice(1)) > 56 ? 'never quiet (below 56)' : crossings(v) < 3 ? 'switches fewer than 3 times' : null,
    ref: b => [b.length, ...Array.from({ length: 399 }, (_, i) => (i % 20 < 10 ? 230 : 30))] },
  image: { kind: 'image', n: 1024,
    check: (v, b) => !isBytes(v, v?.length) || v.length < 1024 ? 'not 1024 numbers from 0 to 255' : v[0] !== b.length ? `first number should be ${b.length}` : v.filter(x => x > 200).length < 400 ? 'not mostly white (fewer than 400 numbers above 200)' : v.filter(x => x < 50).length < 100 ? 'no dark shape (fewer than 100 numbers below 50)' : null,
    ref: b => [b.length, ...Array.from({ length: 1023 }, (_, k) => (k + 1 >= 352 && k + 1 < 672 ? 0 : 255))] },
}

const sum = b => b.reduce((a, x) => a + x, 0)
const max = b => Math.max(...b)
const min = b => Math.min(...b)
const asc = b => [...b].sort((x, y) => x - y)

/** What each type's programs do (the attacker face); every move's spec belongs to its type's family. */
export const FAMILIES = {
  Normal: 'file operations: count, slice, pick, copy, join, reverse', Fire: 'writes: change values in place',
  Water: 'flow: filter, take, drop, flush, buffer', Grass: 'grow and gather: repeat, group, every other, totals of parts',
  Electric: 'peaks: the largest, the spike, surges and cuts', Ice: 'freeze: unchanged copies, cold storage',
  Fighting: 'brute arithmetic: squares, products, multiples', Poison: 'corrupt: inject, offset, smuggle',
  Ground: 'ground: caps, floors, remainders', Flying: 'distribute: serialize, broadcast, scale down',
  Psychic: 'inspect: sort, rank, round, mirror, find', Bug: 'introduce bugs: off-by-one, double frees, leaks',
  Rock: 'raw bytes: sums, sort, running registers', Ghost: 'peek at what is hidden', Dragon: 'absolute: fixed effects from size',
  Dark: 'pick by credential: specific positions, the first match', Steel: 'cipher: XOR, hash, mask', Mystery: 'curse',
}

/** [FireRed name, Code Red name, what the code must compute, answer] */
const TABLE = [
  // NORMAL — file operations
  ['Tackle', 'PING', 'how many numbers there are (the length of the list)', b => b.length],
  ['Scratch', 'SLICE', 'the first 3 numbers', b => b.slice(0, 3)],
  ['Pound', 'POKE', 'the second number (index 1)', b => b[1]],
  ['Horn Attack', 'TAIL', 'the last 2 numbers', b => b.slice(-2)],
  ['Slam', 'FLOOD', 'the list followed by itself (twice as long)', b => [...b, ...b]],
  ['Double Slap', 'UNDO', 'the numbers without the first one', b => b.slice(1)],
  ['Fury Attack', 'SPAM', 'a list of 5 copies of the first number', b => Array(5).fill(b[0])],
  ['Fury Swipes', 'GREP', 'the numbers that are under 50', b => b.filter(x => x < 50)],
  ['Sing', 'DIM', 'how many numbers are even', b => b.filter(x => x % 2 === 0).length],
  ['Smokescreen', 'BLUR', 'the numbers in reverse order', b => [...b].reverse()],
  ['Headbutt', 'REBOOT', 'the first number plus the last', b => b[0] + b.at(-1)],
  ['Hyper Fang', 'CRASH', 'the number at index (first number % number of numbers)', b => b[b[0] % b.length]],
  ['Slash', 'TRUNCATE', 'the first half of the numbers (half rounded down)', b => b.slice(0, Math.floor(b.length / 2))],
  ['Glare', 'DEADLOCK', 'the middle number: the one at index (number of numbers ÷ 2, rounded down)', b => b[Math.floor(b.length / 2)]],
  ['Swift', 'SWIFT', 'the first 2 numbers', b => b.slice(0, 2)],
  ['Leer', 'EXPOSE', 'the index of the smallest number', b => b.indexOf(min(b))],
  ['Tail Whip', 'DOWNGRADE', 'the numbers without the last one', b => b.slice(0, -1)],
  ['Harden', 'HARDEN', "each number written as a string, like 42 → '42' (a list of strings)", b => b.map(String)],
  ['Bind', 'BIND', 'the first and last number, as a list of two', b => [b[0], b.at(-1)]],
  ['Wrap', 'WRAP', 'the numbers wrapped in another list', b => [[...b]]],
  ['Growl', 'ERROR', 'a buzz, as a list of 400 numbers: the first is how many numbers the foe had (data.length), then 399 more that alternate ten at a time: ten 230s, ten 30s, ten 230s, and so on', PAYLOAD.sound],
  ['Flash', 'FLASH', 'a flash, as a list of 1024 numbers (a 32 by 32 picture): the first is how many numbers the foe had (data.length), then 1023 more: 0 (black) at positions 352 to 671, 255 (white) everywhere else', PAYLOAD.image],
  ['Camouflage', 'SPOOF', 'the list with the first and last numbers swapped', b => [b.at(-1), ...b.slice(1, -1), b[0]]],
  ['Supersonic', 'FEEDBACK', 'the sum of the first two numbers', b => b[0] + b[1]],
  ['Defense Curl', 'LOCKDOWN', 'a list holding only the first number', b => [b[0]]],
  ['Screech', 'DISTORTION', 'the numbers after the first half (the first half is half the length, rounded down)', b => b.slice(Math.floor(b.length / 2))],
  ['Disable', 'DISABLE', 'the last number minus the first', b => b.at(-1) - b[0]],
  ['Encore', 'LOOP', 'the counting numbers from 1 up to the length of the list ([1, 2, 3, …])', b => b.map((_, i) => i + 1)],
  ['Sweet Scent', 'LURE', 'the even numbers, in their order', b => b.filter(x => x % 2 === 0)],
  ['Double Team', 'MIRROR', 'the list followed by the same list reversed', b => [...b, ...[...b].reverse()]],
  ['Self Destruct', 'WIPE', 'always 0 (nothing left)', () => 0],
  ['Flail', 'PANIC', 'how many numbers are under 20', b => b.filter(x => x < 20).length],
  ['Focus Energy', 'COMPILE', 'the numbers joined into one string with nothing between them', b => b.join('')],
  ['Follow Me', 'REDIRECT', 'the index of the last number', b => b.length - 1],
  ['Foresight', 'BREAKPOINT', 'the indexes of the numbers greater than 100', b => b.flatMap((x, i) => (x > 100 ? [i] : []))],
  ['Helping Hand', 'SYNC', 'the first number times the second number', b => b[0] * b[1]],
  ['Minimize', 'MINIMIZE', 'the list with its middle number removed (the one at index number of numbers ÷ 2, rounded down)', b => b.filter((_, i) => i !== Math.floor(b.length / 2))],
  ['Quick Attack', 'HOTFIX', 'the first number', b => b[0]],
  ['Rage', 'ECHO', 'add up all the numbers, then add up the digits of that total (532 → 10)', b => String(sum(b)).split('').reduce((a, d) => a + Number(d), 0)],
  ['Thrash', 'THRASH', 'the list followed by itself twice (three times as long)', b => [...b, ...b, ...b]],
  ['Rapid Spin', 'SPINUP', 'the numbers with the first one moved to the end', b => [...b.slice(1), b[0]]],
  ['Recover', 'RECOVER', 'how many numbers are greater than 50', b => b.filter(x => x > 50).length],
  ['Whirlwind', 'FAILOVER', 'the numbers with the last one moved to the front', b => [b.at(-1), ...b.slice(0, -1)]],
  ['Sonic Boom', 'BUZZ', 'how many numbers are over 20', b => b.filter(x => x > 20).length],
  ['Growth', 'UPGRADE', 'the list with one extra number at the end: how many numbers there were', b => [...b, b.length]],
  ['Scary Face', 'FREEZE', 'how many numbers are over 150', b => b.filter(x => x > 150).length],
  ['Splash', 'SPLASH', 'nothing: return without a value', () => undefined],
  ['Yawn', 'TIMEOUT', 'the last number', b => b.at(-1)],
  // FIRE — writes
  ['Ember', 'BURNDISC', 'every number plus 1', b => b.map(x => x + 1)],
  // WATER — flow
  ['Water Gun', 'FLUSH', 'an empty list', () => []],
  ['Water Pulse', 'FILTER', 'the numbers that are 50 or more (the ones under 50 dropped)', b => b.filter(x => x >= 50)],
  ['Withdraw', 'BUFFER', 'the last 3 numbers', b => b.slice(-3)],
  ['Bubble', 'DRIP', 'every second number starting from the second one: the numbers at positions 1, 3, 5… counting from 0', b => b.filter((_, i) => i % 2 === 1)],
  ['Water Sport', 'THROTTLE', 'the numbers that are 100 or less, in their order', b => b.filter(x => x <= 100)],
  // GRASS — grow and gather
  ['Vine Whip', 'CRAWL', 'the numbers at even indexes (0, 2, 4…)', b => b.filter((_, i) => i % 2 === 0)],
  ['Sleep Powder', 'SLEEP', 'the average number, rounded down', b => Math.floor(sum(b) / b.length)],
  ['Spore', 'STANDBY', 'one flat list where each number appears twice in a row ([1, 2] → [1, 1, 2, 2]; not a list of pairs)', b => b.flatMap(x => [x, x])],
  ['Razor Leaf', 'SHARDS', 'the numbers split into two halves, as a list of two lists (the first half is half the length, rounded down)', b => [b.slice(0, Math.floor(b.length / 2)), b.slice(Math.floor(b.length / 2))]],
  ['Stun Spore', 'STALL', 'how many numbers are under 50', b => b.filter(x => x < 50).length],
  ['Absorb', 'SCRAPE', 'half the sum, rounded down', b => Math.floor(sum(b) / 2)],
  ['Leech Seed', 'LEECH SEED', 'the sum of the numbers at even indexes (0, 2, 4…)', b => sum(b.filter((_, i) => i % 2 === 0))],
  // ELECTRIC — peaks
  ['Thunder Wave', 'POWERCUT', 'the numbers in their order, without the largest one', b => { const i = b.indexOf(max(b)); return b.filter((_, j) => j !== i) }],
  ['Spark', 'SPARK', 'the largest number minus the smallest', b => max(b) - min(b)],
  ['Thunder Shock', 'SURGE', 'the largest number plus 1', b => max(b) + 1],
  ['Charge', 'CHARGE', 'the largest number times 2', b => max(b) * 2],
  // ICE — freeze
  ['Icicle Spear', 'SNAPSHOT', 'a copy of the numbers, unchanged', b => [...b]],
  ['Aurora Beam', 'FREEZER', 'the 3 smallest numbers, smallest first', b => asc(b).slice(0, 3)],
  // FIGHTING — brute arithmetic
  ['Karate Chop', 'OVERCLOCK', 'the sum of every number squared', b => sum(b.map(x => x * x))],
  ['Double Kick', 'TWIN', 'each number times 2', b => b.map(x => x * 2)],
  ['Seismic Toss', 'CALL', 'the first number times 3', b => b[0] * 3],
  ['Low Kick', 'DRAIN', 'the smallest number minus 1', b => min(b) - 1],
  ['Revenge', 'REWIND', 'the numbers over 50, last to first', b => b.filter(x => x > 50).reverse()],
  // POISON — corrupt
  ['Poison Sting', 'INJECT', 'the list with one extra number, 1, appended at the end', b => [...b, 1]],
  ['Sludge', 'MALWARE', 'every number plus the first number', b => b.map(x => x + b[0])],
  ['Smog', 'SWARM', 'the sum of only the numbers greater than 100', b => sum(b.filter(x => x > 100))],
  ['Poison Gas', 'TROJAN', 'the list with a copy of its largest number added at the front', b => [max(b), ...b]],
  ['Poison Powder', 'PAYLOAD', 'how many numbers are odd', b => b.filter(x => x % 2 === 1).length],
  ['Acid', 'ACID', 'every number minus 10', b => b.map(x => x - 10)],
  // GROUND — ground
  ['Sand Attack', 'SANDBOX', 'each number capped at 100 (numbers over 100 become 100)', b => b.map(x => Math.min(x, 100))],
  ['Magnitude', 'RNG', 'the sum of the numbers mod 10', b => sum(b) % 10],
  ['Mud Sport', 'GROUND', 'each number capped at 128 (numbers over 128 become 128)', b => b.map(x => Math.min(x, 128))],
  // FLYING — distribute
  ['Peck', 'FETCH', 'the numbers as a JSON string, like [42,13,140]', b => JSON.stringify(b)],
  ['Wing Attack', 'UPLOAD', "the numbers joined into one string with '-' between them", b => b.join('-')],
  ['Aerial Ace', 'SHRINK', 'every number halved, rounded down', b => b.map(x => Math.floor(x / 2))],
  ['Gust', 'BROADCAST', 'a list as long as the input where every entry is the first number', b => b.map(() => b[0])],
  // PSYCHIC — inspect
  ['Hypnosis', 'SUSPEND', 'the index of the largest number', b => b.indexOf(max(b))],
  ['Kinesis', 'GLITCH', "each number's last digit", b => b.map(x => x % 10)],
  ['Confusion', 'SCRAMBLE', 'the numbers sorted from largest to smallest', b => asc(b).reverse()],
  ['Psybeam', 'SMUDGE', 'every number rounded to the nearest 10 (5 rounds up)', b => b.map(x => Math.round(x / 10) * 10)],
  ['Reflect', 'REFLECT', 'each number mirrored around 100: 200 minus the number', b => b.map(x => 200 - x)],
  ['Teleport', 'SSH', 'the largest number', b => max(b)],
  // BUG — introduce bugs
  ['Leech Life', 'LEAK', 'the sum of the last two numbers', b => b.at(-1) + b.at(-2)],
  ['String Shot', 'SKIP', 'the list with its first number added again at the end', b => [...b, b[0]]],
  ['Twineedle', 'DOUBLE', 'the first number, twice (a list of two)', b => [b[0], b[0]]],
  // ROCK — raw bytes
  ['Rock Throw', 'BOOT', 'the sum of the numbers', b => sum(b)],
  ['Rock Tomb', 'BRICK', 'the numbers sorted from smallest to largest', b => asc(b)],
  ['Rollout', 'ROLLOUT', 'the running totals (first number, first two summed, first three…)', b => b.map((_, i) => sum(b.slice(0, i + 1)))],
  // GHOST — peek at what is hidden
  ['Astonish', 'POPUP', 'the numbers except the first and the last (the ones hidden in the middle)', b => b.slice(1, -1)],
  // DRAGON — absolute
  ['Dragon Rage', 'MELTDOWN', 'the length of the list times 10', b => b.length * 10],
  // DARK — pick by credential
  ['Bite', 'PHISH', 'the second-to-last number', b => b.at(-2)],
  ['Pursuit', 'TRACE', 'the index of the first number over 100 (-1 if none)', b => b.findIndex(x => x > 100)],
  // STEEL — cipher
  ['Metal Claw', 'HASH', 'the sum of the numbers mod 256', b => sum(b) % 256],
  ['Metal Sound', 'JAMMER', 'every number XOR 255', b => b.map(x => x ^ 255)],
  // ??? — curse
  ['Curse', 'ROOTKIT', 'every number minus the smallest', b => b.map(x => x - min(b))],
]

/** Function name the code calls: KILL -9 → kill_9, LEECH SEED → leech_seed. */
const RESERVED = new Set(['break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'new', 'return', 'super', 'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'let', 'static', 'enum', 'await'])
export const fnName = name => { const f = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); if (RESERVED.has(f)) throw new Error(`${name}: function name is a JavaScript keyword`); return f }

export const STARTER_MOVES = new Set(['Scratch', 'Growl', 'Ember', 'Metal Claw', 'Tackle', 'Tail Whip', 'Bubble', 'Withdraw', 'Leech Seed', 'Vine Whip'])

/** What kind of answer the key is, shown to the Pokémon next to the spec. */
const shapeOf = ref => {
  const v = ref([12, 40, 7, 33, 190])
  return v === undefined ? 'no key' : v === null ? 'null' : Array.isArray(v) ? 'a list' : typeof v === 'string' ? 'text' : 'a number'
}

export const MOVES = TABLE.map(([firered, name, spec, refOrPayload]) => {
  const [type, power, acc, effect] = FIRERED[firered]
  const payload = typeof refOrPayload === 'object' ? refOrPayload : null
  const ref = payload ? payload.ref : refOrPayload
  return { firered, name, fn: fnName(name), spec, shape: shapeOf(ref), ref, type, power, acc, effect, starter: STARTER_MOVES.has(firered), kept: name === firered.toUpperCase(), ...(payload ? { payload } : {}) }
})

export const byName = Object.fromEntries(MOVES.map(m => [m.name, m]))

/** The ROM's move names are upper case and short (DOUBLESLAP, SAND-ATTACK): match them on letters and digits only. */
const romKey = s => s.toUpperCase().replace(/[^A-Z0-9]/g, '')
const BY_ROM = Object.fromEntries(MOVES.map(m => [romKey(m.firered), m]))
/** A move by its FireRed name as the ROM spells it ('SCRATCH', 'SAND-ATTACK'); undefined if Code Red has no code for it yet. */
export const byFireRed = name => BY_ROM[romKey(name)]
