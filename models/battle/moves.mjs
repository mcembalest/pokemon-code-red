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
  ['Tackle', 'PING', 'how many numbers there are (the length of the list)', b => b.length],
  ['Scratch', 'SLICE', 'the first 3 numbers', b => b.slice(0, 3)],
  ['Pound', 'POKE', 'the second number (index 1)', b => b[1]],
  ['Peck', 'FETCH', 'the last number', b => b.at(-1)],
  ['Horn Attack', 'SPIKE', 'the index of the largest number', b => b.indexOf(max(b))],
  ['Rock Throw', 'BOOTDRIVE', 'the sum of the numbers', b => sum(b)],
  ['Slam', 'FORKBOMB', 'each number times 2', b => b.map(x => x * 2)],
  ['Vine Whip', 'CRAWL', 'the numbers at even indexes (0, 2, 4…)', b => b.filter((_, i) => i % 2 === 0)],
  ['Water Gun', 'FLUSH', 'an empty list', () => []],
  ['Wing Attack', 'UPLOAD', "the numbers joined into one string with '-' between them", b => b.join('-')],
  // multi hit
  ['Double Slap', 'UNDO', 'the numbers without the first one', b => b.slice(1)],
  ['Fury Attack', 'SPAM', 'a list of 5 copies of the first number', b => Array(5).fill(b[0])],
  ['Fury Swipes', 'BRUTEFORCE', 'the numbers that are under 50', b => b.filter(x => x < 50)],
  ['Icicle Spear', 'SNAPSHOT', 'a copy of the numbers, unchanged', b => [...b]],
  // sleep
  ['Hypnosis', 'SUSPEND', 'the numbers without the last one', b => b.slice(0, -1)],
  ['Sing', 'SCREENSAVER', 'how many numbers are even', b => b.filter(x => x % 2 === 0).length],
  ['Sleep Powder', 'HIBERNATE', 'the average number, rounded down', b => Math.floor(sum(b) / b.length)],
  ['Spore', 'STANDBY', 'the first number minus the last', b => b[0] - b.at(-1)],
  // accuracy down
  ['Kinesis', 'GLITCH', "each number's last digit", b => b.map(x => x % 10)],
  ['Sand Attack', 'SANDBOX', 'each number capped at 100 (numbers over 100 become 100)', b => b.map(x => Math.min(x, 100))],
  ['Smokescreen', 'OBFUSCATE', 'every number XOR 255', b => b.map(x => x ^ 255)],
  // confuse hit
  ['Confusion', 'SCRAMBLE', 'the numbers sorted from largest to smallest', b => asc(b).reverse()],
  ['Psybeam', 'DEEPFAKE', 'every number rounded to the nearest 10 (5 rounds up)', b => b.map(x => Math.round(x / 10) * 10)],
  ['Water Pulse', 'DROPTABLE', 'the numbers with every number under 50 dropped', b => b.filter(x => x >= 50)],
  // flinch hit
  ['Bite', 'PHISH', 'the second-to-last number', b => b.at(-2)],
  ['Headbutt', 'REBOOT', 'the first number plus the last', b => b[0] + b.at(-1)],
  ['Hyper Fang', 'SEGFAULT', 'the number at index (first number % number of numbers)', b => b[b[0] % b.length]],
  // high critical
  ['Karate Chop', 'OVERCLOCK', 'the sum of every number squared', b => sum(b.map(x => x * x))],
  ['Razor Leaf', 'SHARDS', 'the numbers split into pairs; an odd last number is a pair of one', b => b.reduce((a, x, i) => (i % 2 ? a.at(-1).push(x) : a.push([x]), a), [])],
  ['Slash', 'TRUNCATE', 'the first half of the numbers (half rounded down)', b => b.slice(0, Math.floor(b.length / 2))],
  // paralyze
  ['Glare', 'BROWNOUT', 'the smallest number multiplied by the length of the list', b => min(b) * b.length],
  ['Stun Spore', 'SPINLOCK', 'how many numbers are under 50', b => b.filter(x => x < 50).length],
  ['Thunder Wave', 'POWERCUT', 'the numbers in their order, without the largest one', b => { const i = b.indexOf(max(b)); return b.filter((_, j) => j !== i) }],
  // poison hit / poison
  ['Poison Sting', 'INJECT', 'the numbers with a 1 added at the end', b => [...b, 1]],
  ['Sludge', 'MALWARE', 'every number plus the first number', b => b.map(x => x + b[0])],
  ['Smog', 'BOTNET', 'the sum of only the numbers greater than 100', b => sum(b.filter(x => x > 100))],
  ['Poison Gas', 'TROJAN', 'the numbers in their order, but with the largest moved to the front', b => { const i = b.indexOf(max(b)); return [b[i], ...b.filter((_, j) => j !== i)] }],
  ['Poison Powder', 'PAYLOAD', 'how many numbers are odd', b => b.filter(x => x % 2 === 1).length],
  // absorb
  ['Absorb', 'SCRAPE', 'half the sum, rounded down', b => Math.floor(sum(b) / 2)],
  ['Leech Life', 'LEAK', 'the sum of the last two numbers', b => b.at(-1) + b.at(-2)],
  // always hit
  ['Aerial Ace', 'AUTOSCALE', 'every number halved, rounded down', b => b.map(x => Math.floor(x / 2))],
  ['Swift', 'SWIFT', 'the first number plus 1', b => b[0] + 1],
  // defense down
  ['Leer', 'EXPOSE', 'the index of the smallest number', b => b.indexOf(min(b))],
  ['Tail Whip', 'DOWNGRADE', 'the largest number', b => max(b)],
  // defense up
  ['Harden', 'HARDEN', 'the smallest number', b => min(b)],
  ['Withdraw', 'BACKUP', 'the numbers in reverse order', b => [...b].reverse()],
  // paralyze hit
  ['Spark', 'SPARK', 'the largest number minus the smallest', b => max(b) - min(b)],
  ['Thunder Shock', 'SURGE', 'the largest number plus 1', b => max(b) + 1],
  // speed down hit
  ['Bubble', 'WIPEDISC', 'every number replaced by 0', b => b.map(() => 0)],
  ['Rock Tomb', 'BRICK', 'the numbers sorted from smallest to largest', b => asc(b)],
  // trap
  ['Bind', 'BIND', 'the first and last number, as a list of two', b => [b[0], b.at(-1)]],
  ['Wrap', 'WRAP', 'the numbers wrapped in another list', b => [[...b]]],
  // one of a kind
  ['Growl', 'ERRORMSG', "the text 'ERROR ' followed by how many numbers there are, e.g. 'ERROR 3'", b => `ERROR ${b.length}`],
  ['Aurora Beam', 'COLDSTORAGE', 'the 3 smallest numbers, smallest first', b => asc(b).slice(0, 3)],
  ['Metal Claw', 'HASH', 'the sum of the numbers mod 256', b => sum(b) % 256],
  ['Ember', 'BURNDISC', 'every number plus 1', b => b.map(x => x + 1)],
  ['Camouflage', 'SPOOF', 'each number turned into text (a list of strings)', b => b.map(String)],
  ['Charge', 'CHARGE', 'the largest number times 2', b => max(b) * 2],
  ['Supersonic', 'FEEDBACK', 'the sum of the first two numbers', b => b[0] + b[1]],
  ['Curse', 'ROOTKIT', 'every number minus the smallest', b => b.map(x => x - min(b))],
  ['Defense Curl', 'LOCKDOWN', 'the first number times 2', b => b[0] * 2],
  ['Screech', 'DISTORTION', 'the sum minus the largest number', b => sum(b) - max(b)],
  ['Acid', 'ACID', 'the sum of the numbers if all of them are under 150, otherwise 0', b => (b.every(x => x < 150) ? sum(b) : 0)],
  ['Disable', 'DISABLE', 'the last number minus the first', b => b.at(-1) - b[0]],
  ['Double Kick', 'COPYPASTE', 'the list followed by itself (twice as long)', b => [...b, ...b]],
  ['Dragon Rage', 'KERNELPANIC', 'the length of the list times 10', b => b.length * 10],
  ['Encore', 'LOOP', 'a list with as many entries as the input, every entry equal to the first number', b => b.map(() => b[0])],
  ['Sweet Scent', 'HONEYPOT', 'the largest even number (0 if none)', b => { const e = b.filter(x => x % 2 === 0); return e.length ? max(e) : 0 }],
  ['Double Team', 'MIRROR', 'the list followed by the same list reversed', b => [...b, ...[...b].reverse()]],
  ['Self Destruct', 'RM -RF', 'the number 0 (nothing left)', () => 0],
  ['Flail', 'PANIC', 'how many numbers are under 20', b => b.filter(x => x < 20).length],
  ['Astonish', 'POPUP', 'the number at index (number of numbers ÷ 2, rounded down)', b => b[Math.floor(b.length / 2)]],
  ['Focus Energy', 'COMPILE', 'the numbers joined into one string with nothing between them', b => b.join('')],
  ['Follow Me', 'REDIRECT', 'the index of the last number', b => b.length - 1],
  ['Foresight', 'DEBUGGER', 'the indexes of the numbers greater than 100', b => b.flatMap((x, i) => (x > 100 ? [i] : []))],
  ['Gust', 'BROADCAST', 'each number plus the last number', b => b.map(x => x + b.at(-1))],
  ['Helping Hand', 'PAIRPROGRAM', 'the first number times the second number', b => b[0] * b[1]],
  ['Leech Seed', 'LEECH SEED', 'the sum of the numbers at even indexes (0, 2, 4…)', b => sum(b.filter((_, i) => i % 2 === 0))],
  ['Seismic Toss', 'THROW', 'the first number times 3', b => b[0] * 3],
  ['Low Kick', 'UNDERFLOW', 'the smallest number minus 1', b => min(b) - 1],
  ['Magnitude', 'RNG', 'the sum of the numbers mod 10', b => sum(b) % 10],
  ['Minimize', 'MINIMIZE', 'the numbers with repeats removed (keep the first of each)', b => [...new Set(b)]],
  ['Mud Sport', 'GROUNDWIRE', 'each number capped at 128 (numbers over 128 become 128)', b => b.map(x => Math.min(x, 128))],
  ['Pursuit', 'TRACEROUTE', 'the index of the first number over 100 (-1 if none)', b => b.findIndex(x => x > 100)],
  ['Quick Attack', 'HOTFIX', 'the first number', b => b[0]],
  ['Rage', 'RECURSION', 'add up all the numbers, then add up the digits of that total (532 → 10)', b => String(sum(b)).split('').reduce((a, d) => a + Number(d), 0)],
  ['Thrash', 'THRASH', 'each number times the length of the list', b => b.map(x => x * b.length)],
  ['Rapid Spin', 'SPINUP', 'the numbers with the first one moved to the end', b => [...b.slice(1), b[0]]],
  ['Reflect', 'REFLECT', 'each number mirrored around 100: 200 minus the number', b => b.map(x => 200 - x)],
  ['Recover', 'RECOVER', 'how many numbers are greater than 50', b => b.filter(x => x > 50).length],
  ['Revenge', 'BACKTRACE', 'the numbers over 50, last to first', b => b.filter(x => x > 50).reverse()],
  ['Whirlwind', 'FAILOVER', 'the numbers with the last one moved to the front', b => [b.at(-1), ...b.slice(0, -1)]],
  ['Rollout', 'ROLLOUT', 'the running totals (first number, first two summed, first three…)', b => b.map((_, i) => sum(b.slice(0, i + 1)))],
  ['Sonic Boom', 'DIALUP', 'how many numbers are over 20', b => b.filter(x => x > 20).length],
  ['Growth', 'UPGRADE', 'the largest number plus the smallest', b => max(b) + min(b)],
  ['Metal Sound', 'JAMMER', 'the numbers without the ones at indexes 2, 5, 8…', b => b.filter((_, i) => i % 3 !== 2)],
  ['String Shot', 'STRINGIFY', 'the numbers as a JSON string', b => JSON.stringify(b)],
  ['Scary Face', 'BLUESCREEN', 'how many numbers are over 150', b => b.filter(x => x > 150).length],
  ['Splash', 'SPLASH', 'nothing: return without a value', () => undefined],
  ['Teleport', 'SSH', 'the list with the first and last numbers swapped', b => [b.at(-1), ...b.slice(1, -1), b[0]]],
  ['Twineedle', 'DOUBLEFREE', 'the first number, twice (a list of two)', b => [b[0], b[0]]],
  ['Water Sport', 'HEATSINK', 'each number capped at 150 (numbers over 150 become 150)', b => b.map(x => Math.min(x, 150))],
  ['Yawn', 'TIMEOUT', 'half the largest number, rounded down', b => Math.floor(max(b) / 2)],
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
