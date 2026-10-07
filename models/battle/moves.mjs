// Code Red moves before Misty (draft 2026-10-07). One source of truth for names, specs and answers.
// FireRed keeps each move's type, power, accuracy, effect and animation; the name and the code change.
// Owner rules: plain technical words that sound cool; a FireRed name that is already a real tech word stays.
//
// The battle rule: clean the foe's bytes the way its types demand → compute what the move asks for →
// strike once with the answer (`await tools.<fn>({ key })`), within the byte budget.
// `ref(b, foe)` = the right answer. b = the foe's bytes after cleanup; foe = what scan() returned.
// Indexes count from 0. No answer is null (Workers AI drops `null` tokens from some models' streams). Ties → the first one. "Rounded down" = Math.floor.
import { readFileSync } from 'node:fs'

const FR = JSON.parse(readFileSync(new URL('./firered-moves.json', import.meta.url), 'utf8'))

const sum = b => b.reduce((a, x) => a + x, 0)
const max = b => Math.max(...b)
const min = b => Math.min(...b)
const asc = b => [...b].sort((x, y) => x - y)

/** [FireRed name, Code Red name, what the code must compute, answer] */
const TABLE = [
  // hit
  ['Tackle', 'PING', 'how many bytes there are', b => b.length],
  ['Scratch', 'SLICE', 'the first 3 bytes', b => b.slice(0, 3)],
  ['Pound', 'POKE', 'the second byte (index 1)', b => b[1]],
  ['Peck', 'FETCH', 'the last byte', b => b.at(-1)],
  ['Horn Attack', 'SPIKE', 'the index of the largest byte', b => b.indexOf(max(b))],
  ['Rock Throw', 'BOOTDRIVE', 'the sum of the bytes', b => sum(b)],
  ['Slam', 'FORKBOMB', 'each byte times 2', b => b.map(x => x * 2)],
  ['Vine Whip', 'CRAWL', 'the bytes at even indexes (0, 2, 4…)', b => b.filter((_, i) => i % 2 === 0)],
  ['Water Gun', 'FLUSH', 'every byte set to 0', b => b.map(() => 0)],
  ['Wing Attack', 'UPLOAD', "the bytes joined into one string with '-' between them", b => b.join('-')],
  // multi hit
  ['Double Slap', 'UNDO', 'the bytes without the first one', b => b.slice(1)],
  ['Fury Attack', 'SPAM', 'the first byte, repeated 5 times', b => Array(5).fill(b[0])],
  ['Fury Swipes', 'BRUTEFORCE', 'the bytes that are under 50', b => b.filter(x => x < 50)],
  ['Icicle Spear', 'SNAPSHOT', 'a copy of the bytes, unchanged', b => [...b]],
  // sleep
  ['Hypnosis', 'SUSPEND', 'the bytes without the last one', b => b.slice(0, -1)],
  ['Sing', 'SCREENSAVER', 'how many bytes are even', b => b.filter(x => x % 2 === 0).length],
  ['Sleep Powder', 'HIBERNATE', 'the average byte, rounded down', b => Math.floor(sum(b) / b.length)],
  ['Spore', 'STANDBY', 'the first byte minus the last', b => b[0] - b.at(-1)],
  // accuracy down
  ['Kinesis', 'GLITCH', "each byte's last digit", b => b.map(x => x % 10)],
  ['Sand Attack', 'SANDBOX', 'every byte, capped at 100', b => b.map(x => Math.min(x, 100))],
  ['Smokescreen', 'OBFUSCATE', 'every byte XOR 255', b => b.map(x => x ^ 255)],
  // confuse hit
  ['Confusion', 'SCRAMBLE', 'the bytes sorted from largest to smallest', b => asc(b).reverse()],
  ['Psybeam', 'DEEPFAKE', 'every byte rounded to the nearest 10 (5 rounds up)', b => b.map(x => Math.round(x / 10) * 10)],
  ['Water Pulse', 'DROPTABLE', 'the bytes with every byte under 50 dropped', b => b.filter(x => x >= 50)],
  // flinch hit
  ['Bite', 'PHISH', 'the second-to-last byte', b => b.at(-2)],
  ['Headbutt', 'REBOOT', 'the first byte plus the last', b => b[0] + b.at(-1)],
  ['Hyper Fang', 'SEGFAULT', 'the byte at index (first byte % number of bytes)', b => b[b[0] % b.length]],
  // high critical
  ['Karate Chop', 'OVERCLOCK', 'the sum of every byte squared', b => sum(b.map(x => x * x))],
  ['Razor Leaf', 'SHARDS', 'the bytes split into pairs; an odd last byte is a pair of one', b => b.reduce((a, x, i) => (i % 2 ? a.at(-1).push(x) : a.push([x]), a), [])],
  ['Slash', 'TRUNCATE', 'the first half of the bytes (half rounded down)', b => b.slice(0, Math.floor(b.length / 2))],
  // paralyze
  ['Glare', 'BROWNOUT', 'the smallest byte times how many bytes', b => min(b) * b.length],
  ['Stun Spore', 'SPINLOCK', 'how many bytes are under 50', b => b.filter(x => x < 50).length],
  ['Thunder Wave', 'POWERCUT', 'the bytes with the largest one removed', b => { const i = b.indexOf(max(b)); return b.filter((_, j) => j !== i) }],
  // poison hit / poison
  ['Poison Sting', 'INJECT', 'the bytes with a 1 added at the end', b => [...b, 1]],
  ['Sludge', 'MALWARE', 'every byte plus the first byte', b => b.map(x => x + b[0])],
  ['Smog', 'BOTNET', 'the sum of the bytes over 100', b => sum(b.filter(x => x > 100))],
  ['Poison Gas', 'TROJAN', 'the bytes with the largest moved to the front', b => { const i = b.indexOf(max(b)); return [b[i], ...b.filter((_, j) => j !== i)] }],
  ['Poison Powder', 'PAYLOAD', 'how many bytes are odd', b => b.filter(x => x % 2 === 1).length],
  // absorb
  ['Absorb', 'SCRAPE', 'half the sum, rounded down', b => Math.floor(sum(b) / 2)],
  ['Leech Life', 'LEAK', 'the sum of the last two bytes', b => b.at(-1) + b.at(-2)],
  // always hit
  ['Aerial Ace', 'AUTOSCALE', 'every byte halved, rounded down', b => b.map(x => Math.floor(x / 2))],
  ['Swift', 'SWIFT', 'the first byte plus 1', b => b[0] + 1],
  // defense down
  ['Leer', 'EXPOSE', 'the index of the smallest byte', b => b.indexOf(min(b))],
  ['Tail Whip', 'DOWNGRADE', 'the largest byte', b => max(b)],
  // defense up
  ['Harden', 'HARDEN', 'the smallest byte', b => min(b)],
  ['Withdraw', 'BACKUP', 'the bytes in reverse order', b => [...b].reverse()],
  // paralyze hit
  ['Spark', 'SPARK', 'the largest byte minus the smallest', b => max(b) - min(b)],
  ['Thunder Shock', 'SURGE', 'the largest byte plus 1', b => max(b) + 1],
  // speed down hit
  ['Bubble', 'WIPEDISC', 'an empty list', () => []],
  ['Rock Tomb', 'BRICK', 'the bytes sorted from smallest to largest', b => asc(b)],
  // trap
  ['Bind', 'BIND', 'the first and last byte, as a list of two', b => [b[0], b.at(-1)]],
  ['Wrap', 'WRAP', 'the bytes wrapped in another list', b => [[...b]]],
  // one of a kind
  ['Growl', 'ERRORMSG', "the text 'ERROR ' followed by how many bytes there are", b => `ERROR ${b.length}`],
  ['Aurora Beam', 'COLDSTORAGE', 'the 3 smallest bytes, smallest first', b => asc(b).slice(0, 3)],
  ['Metal Claw', 'HASH', 'the sum of the bytes mod 256', b => sum(b) % 256],
  ['Ember', 'BURNDISC', 'every byte plus 1', b => b.map(x => x + 1)],
  ['Camouflage', 'SPOOF', "how many letters are in the foe's first type", (b, f) => f.types[0].length],
  ['Charge', 'CHARGE', 'the largest byte times 2', b => max(b) * 2],
  ['Supersonic', 'FEEDBACK', 'the sum of the first two bytes', b => b[0] + b[1]],
  ['Curse', 'ROOTKIT', 'every byte minus the smallest', b => b.map(x => x - min(b))],
  ['Defense Curl', 'LOCKDOWN', 'the first byte times 2', b => b[0] * 2],
  ['Screech', 'DISTORTION', 'the sum minus the largest byte', b => sum(b) - max(b)],
  ['Acid', 'ACID', 'the sum if every byte is under 150, otherwise 0', b => (b.every(x => x < 150) ? sum(b) : 0)],
  ['Disable', 'DISABLE', 'the last byte minus the first', b => b.at(-1) - b[0]],
  ['Double Kick', 'COPYPASTE', 'the bytes, then the bytes again', b => [...b, ...b]],
  ['Dragon Rage', 'KERNELPANIC', 'how many bytes, times 10', b => b.length * 10],
  ['Encore', 'LOOP', 'a list as long as the bytes, every entry the first byte', b => b.map(() => b[0])],
  ['Sweet Scent', 'HONEYPOT', 'the largest even byte (0 if none)', b => { const e = b.filter(x => x % 2 === 0); return e.length ? max(e) : 0 }],
  ['Double Team', 'MIRROR', 'the bytes, then the bytes in reverse', b => [...b, ...[...b].reverse()]],
  ['Self Destruct', 'RM -RF', 'the number 0 (nothing left)', () => 0],
  ['Flail', 'PANIC', 'how many bytes are under 20', b => b.filter(x => x < 20).length],
  ['Astonish', 'POPUP', 'the byte at index (number of bytes ÷ 2, rounded down)', b => b[Math.floor(b.length / 2)]],
  ['Focus Energy', 'COMPILE', 'the bytes joined into one string with nothing between them', b => b.join('')],
  ['Follow Me', 'REDIRECT', 'the index of the last byte', b => b.length - 1],
  ['Foresight', 'DEBUGGER', 'the indexes of the bytes over 100', b => b.flatMap((x, i) => (x > 100 ? [i] : []))],
  ['Gust', 'BROADCAST', 'every byte plus the last byte', b => b.map(x => x + b.at(-1))],
  ['Helping Hand', 'PAIRPROGRAM', 'the first byte times the second', b => b[0] * b[1]],
  ['Leech Seed', 'LEECH SEED', 'the sum of the bytes at even indexes (0, 2, 4…)', b => sum(b.filter((_, i) => i % 2 === 0))],
  ['Seismic Toss', 'THROW', "the foe's level", (b, f) => f.level],
  ['Low Kick', 'UNDERFLOW', 'the smallest byte minus 1', b => min(b) - 1],
  ['Magnitude', 'RNG', 'the sum of the bytes mod 10', b => sum(b) % 10],
  ['Minimize', 'MINIMIZE', 'the bytes with repeats removed (keep the first of each)', b => [...new Set(b)]],
  ['Mud Sport', 'GROUNDWIRE', 'every byte, capped at 128', b => b.map(x => Math.min(x, 128))],
  ['Pursuit', 'TRACEROUTE', 'the index of the first byte over 100 (-1 if none)', b => b.findIndex(x => x > 100)],
  ['Quick Attack', 'HOTFIX', 'the first byte', b => b[0]],
  ['Rage', 'RECURSION', 'the sum of the digits of the sum of the bytes', b => String(sum(b)).split('').reduce((a, d) => a + Number(d), 0)],
  ['Thrash', 'THRASH', 'every byte times how many bytes', b => b.map(x => x * b.length)],
  ['Rapid Spin', 'SPINUP', 'the bytes with the first one moved to the end', b => [...b.slice(1), b[0]]],
  ['Reflect', 'REFLECT', 'the names of the fields scan() returned, in order', (b, f) => Object.keys(f)],
  ['Recover', 'RECOVER', 'the bytes exactly as scanned, before cleanup', (b, f) => f.bytes],
  ['Revenge', 'BACKTRACE', 'the bytes over 50, last to first', b => b.filter(x => x > 50).reverse()],
  ['Whirlwind', 'FAILOVER', 'the bytes with the last one moved to the front', b => [b.at(-1), ...b.slice(0, -1)]],
  ['Rollout', 'ROLLOUT', 'the running totals (first byte, first two summed, first three…)', b => b.map((_, i) => sum(b.slice(0, i + 1)))],
  ['Sonic Boom', 'DIALUP', 'how many bytes are over 20', b => b.filter(x => x > 20).length],
  ['Growth', 'UPGRADE', 'the largest byte plus the smallest', b => max(b) + min(b)],
  ['Metal Sound', 'JAMMER', 'the bytes without the ones at indexes 2, 5, 8…', b => b.filter((_, i) => i % 3 !== 2)],
  ['String Shot', 'STRINGIFY', 'the bytes as a JSON string', b => JSON.stringify(b)],
  ['Scary Face', 'BLUESCREEN', 'how many bytes are over 150', b => b.filter(x => x > 150).length],
  ['Splash', 'SPLASH', 'no key at all: strike with nothing', () => undefined],
  ['Teleport', 'SSH', "the foe's name", (b, f) => f.name],
  ['Twineedle', 'DOUBLEFREE', 'the first byte, twice (a list of two)', b => [b[0], b[0]]],
  ['Water Sport', 'HEATSINK', 'every byte, capped at 150', b => b.map(x => Math.min(x, 150))],
  ['Yawn', 'TIMEOUT', 'half the largest byte, rounded down', b => Math.floor(max(b) / 2)],
]

/** Function name the code calls: KILL -9 → kill_9, LEECH SEED → leech_seed. */
export const fnName = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

export const STARTER_MOVES = new Set(['Scratch', 'Growl', 'Ember', 'Metal Claw', 'Tackle', 'Tail Whip', 'Bubble', 'Withdraw', 'Leech Seed', 'Vine Whip'])

/** What kind of answer the key is, shown to the Pokémon next to the spec. */
const shapeOf = ref => {
  const v = ref([12, 40, 7, 33, 190], { name: 'RATTATA', level: 3, types: ['NORMAL'], status: 'none', bytes: [12, 40, 7, 33, 190] })
  return v === undefined ? 'no key' : v === null ? 'null' : Array.isArray(v) ? 'a list' : typeof v === 'string' ? 'text' : 'a number'
}

export const MOVES = TABLE.map(([firered, name, spec, ref]) => {
  const [type, power, acc, effect] = FR[firered]
  return { firered, name, fn: fnName(name), spec, shape: shapeOf(ref), ref, type, power, acc, effect, starter: STARTER_MOVES.has(firered), kept: name === firered.toUpperCase() }
})

export const byName = Object.fromEntries(MOVES.map(m => [m.name, m]))
