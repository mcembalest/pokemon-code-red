// Code Red moves: every move a player can meet before Erika (scripts/inventory.py). One source of truth for names, specs and answers.
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

import { PAYLOAD } from './payload.mjs'

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

/** THE CONTROL PANEL for moves (owner, 2026-10-12: "one place … make the changes I wanna make later on").
 *  One row per move: [FireRed name, CODE RED NAME, what the code must compute, the answer].
 *  To rename a move: change the second column, run `make names` (the ROM's name table + notes/moves.md), `make build`.
 *  To change what it asks for: change the third and fourth columns together, run `make test`.
 *  Names: 12 characters at most, upper case; a name that is a JS keyword is refused. notes/moves.md is the readable copy. */
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
  ['Sing', 'DIM', 'a soft voice to sing its tune with: one cycle of a smooth, round wave (16 to 256 numbers around 128, up once and down once, no jumps)', PAYLOAD.lullaby],
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
  ['Growl', 'ERROR', 'a glitchy growl: a list of about 3200 numbers, a buzzy square wave whose pitch slides down, with a wobbling voice (change d slowly), a little random grit and a stutter, fading out', PAYLOAD.growl],
  ['Flash', 'FLASH', 'a flash: a list of 4096 numbers, 4 frames of 1024: a bright round core with rays around it that grows bigger frame by frame (brightest in the middle) and breaks into sparkles in the last frame', PAYLOAD.flash],
  ['Camouflage', 'SPOOF', 'the list with the first and last numbers swapped', b => [b.at(-1), ...b.slice(1, -1), b[0]]],
  ['Supersonic', 'FEEDBACK', 'a thin ringing voice to ring its rings with: one cycle of a narrow pulse (16 to 256 numbers around 128: high for under 30% of the cycle, low the rest)', PAYLOAD.ring],
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
  ['Sonic Boom', 'BUZZ', 'a rough buzzing voice to blast its booms with: one cycle of a gritty wave (16 to 256 numbers around 128, crossing 128 at least 6 times: noise or overtones)', PAYLOAD.buzz],
  ['Growth', 'UPGRADE', 'the list with one extra number at the end: how many numbers there were', b => [...b, b.length]],
  ['Scary Face', 'FREEZE', 'how many numbers are over 150', b => b.filter(x => x > 150).length],
  ['Splash', 'SPLASH', 'nothing: return without a value', () => undefined],
  ['Yawn', 'TIMEOUT', 'the last number', b => b.at(-1)],
  // to Lt. Surge (2026-10-11; names are mine, flagged): what the route from Cerulean to Vermilion uses
  ['Cut', 'CUT', 'the numbers without the first 2', b => b.slice(2)],
  ['Constrict', 'CLIP', 'the first 4 numbers', b => b.slice(0, 4)],
  ['Odor Sleuth', 'SNIFF', 'how many numbers are over 100', b => b.filter(x => x > 100).length],
  ['Pay Day', 'PAYOUT', 'the first number times 10', b => b[0] * 10],
  ['Protect', 'FIREWALL', 'a list holding only the last number', b => [b.at(-1)]],
  ['Roar', 'ROTATE', 'the numbers rotated by two: the first two moved to the end', b => [...b.slice(2), ...b.slice(0, 2)]],
  ['Stomp', 'STOMP', 'the last 3 numbers, last to first', b => b.slice(-3).reverse()],
  ['Take Down', 'SHUTDOWN', 'the first number minus the last', b => b[0] - b.at(-1)],
  // to Erika (2026-10-11; names mine, flagged): Route 9, Rock Tunnel, Lavender, Celadon
  ['Barrage', 'SPAMMER', 'a list of 3 copies of the last number', b => Array(3).fill(b.at(-1))],
  ['Horn Drill', 'KILL', 'always the single number 0 (a list of one)', () => [0]],
  ['Spit Up', 'DUMP', 'the numbers joined into one string with a space between them', b => b.join(' ')],
  ['Stockpile', 'CACHE', 'the list followed by its length (one extra number at the end)', b => [...b, b.length]],
  ['Swallow', 'PURGE', 'the number of numbers minus 1', b => b.length - 1],
  ['Tri Attack', 'TRIPLE', 'the first 3 numbers, each times 3', b => b.slice(0, 3).map(x => x * 3)],
  ['Uproar', 'NOISE', 'the numbers with every one of them doubled, except the first', b => b.map((x, i) => (i === 0 ? x : x * 2))],
  // the rest of what a player can meet before Erika (2026-10-12, scripts/inventory.py; names mine, flagged):
  // level-up moves to L45 of every catchable species and evolution, the TMs found or sold on the way, every trainer's moves
  ['Attract', 'MAGNET', 'the index of the first even number (-1 if none)', b => b.findIndex(x => x % 2 === 0)],
  ['Baton Pass', 'HANDOFF', 'the second and third numbers (indexes 1 and 2)', b => b.slice(1, 3)],
  ['Belly Drum', 'OVERDRIVE', 'the first number times the number of numbers', b => b[0] * b.length],
  ['Body Slam', 'CRUSH', 'the sum of all the numbers minus the largest', b => sum(b) - max(b)],
  ['Endeavor', 'CATCHUP', 'the largest number minus the first number', b => max(b) - b[0]],
  ['Explosion', 'FORMAT', "always an empty string ('')", () => ''],
  ['Fake Out', 'DECOY', "the first number written as a string (42 → '42')", b => String(b[0])],
  ['Guillotine', 'SEGFAULT', 'always -1', () => -1],
  ['Hyper Beam', 'LASER', 'the sum of the numbers times the number of numbers', b => sum(b) * b.length],
  ['Hyper Voice', 'SHOUT', "the numbers joined into one string with '!' between them", b => b.join('!')],
  ['Lock On', 'TARGET', 'the index of the last number over 50 (-1 if none)', b => b.findLastIndex(x => x > 50)],
  ['Mimic', 'CLONE', 'a list of two copies of the list (a list of two lists)', b => [[...b], [...b]]],
  ['Moonlight', 'DARKMODE', 'every number minus 1', b => b.map(x => x - 1)],
  ['Psych Up', 'COPYCAT', 'a list of 3 copies of the first number', b => Array(3).fill(b[0])],
  ['Safeguard', 'CHECKSUM', 'the sum of the numbers mod 100', b => sum(b) % 100],
  ['Secret Power', 'CHEATCODE', 'the number at index 3 (the fourth one)', b => b[3]],
  ['Skull Bash', 'HEADER', 'the first number, then how many numbers there are (a list of two)', b => [b[0], b.length]],
  ['Spike Cannon', 'VOLLEY', 'a list of 4 copies of the largest number', b => Array(4).fill(max(b))],
  ['Super Fang', 'BISECT', 'the largest number halved, rounded down', b => Math.floor(max(b) / 2)],
  ['Swagger', 'HYPE', 'every number times 3', b => b.map(x => x * 3)],
  ['Transform', 'MORPH', 'the indexes of the numbers, as a list ([0, 1, 2, …])', b => b.map((_, i) => i)],
  ['Vice Grip', 'PINCH', 'the smallest number and the largest, as a list of two', b => [min(b), max(b)]],
  ['Brick Break', 'SMASH', 'the first number squared', b => b[0] * b[0]],
  ['Cross Chop', 'CROSSCUT', 'the largest number minus the second-largest', b => { const s = asc(b); return s[s.length - 1] - s[s.length - 2] }],
  ['Superpower', 'BRUTEFORCE', 'the product of all the numbers, mod 1000', b => b.reduce((a, x) => (a * x) % 1000, 1)],
  ['Crabhammer', 'HAMMER', 'the numbers 100 or under, last to first (the ones over 100 dropped)', b => b.filter(x => x <= 100).reverse()],
  ['Waterfall', 'CASCADE', 'each number minus the one before it; the first stays as it is', b => b.map((x, i) => (i === 0 ? x : x - b[i - 1]))],
  ['Clamp', 'CLAMP', 'the numbers from 50 to 150 inclusive, in their order', b => b.filter(x => x >= 50 && x <= 150)],
  ['Petal Dance', 'BLOOM', 'the sum of the numbers at indexes 0, 3, 6… (every third, starting with the first)', b => sum(b.filter((_, i) => i % 3 === 0))],
  ['Thunder', 'OVERLOAD', 'the largest number times 3', b => max(b) * 3],
  ['Thunder Punch', 'ZAP', 'the largest number plus the smallest', b => max(b) + min(b)],
  ['Haze', 'DEFROST', 'a list of zeros as long as the list', b => b.map(() => 0)],
  ['Ice Beam', 'COLDSTORE', 'the numbers sorted smallest to largest, as a list of strings', b => asc(b).map(String)],
  ['Iron Tail', 'IRONMASK', 'every number AND 240 (the low 4 bits cleared: 47 becomes 32)', b => b.map(x => x & 240)],
  ['Shadow Ball', 'PHANTOM', 'the last number minus the second-to-last', b => b.at(-1) - b.at(-2)],
  ['Acid Armor', 'CORRODE', 'every number minus its index (the first −0, the second −1…)', b => b.map((x, i) => x - i)],
  ['Sludge Bomb', 'VIRUS', 'every number plus the last number', b => b.map(x => x + b.at(-1))],
  ['Amnesia', 'FORGET', 'the numbers without the first 3', b => b.slice(3)],
  ['Barrier', 'SHIELD', 'the numbers that are at least the average (the average rounded down), in their order', b => { const a = Math.floor(sum(b) / b.length); return b.filter(x => x >= a) }],
  ['Cosmic Power', 'ALIGN', 'each number minus the average (the average rounded down)', b => { const a = Math.floor(sum(b) / b.length); return b.map(x => x - a) }],
  ['Imprison', 'LOCK', 'how many numbers are greater than the one before them (the first never counts)', b => b.filter((x, i) => i > 0 && x > b[i - 1]).length],
  ['Light Screen', 'SCREEN', 'the second-smallest number', b => asc(b)[1]],
  ['Rest', 'SLEEPMODE', 'the smallest number plus the largest, halved and rounded down', b => Math.floor((min(b) + max(b)) / 2)],
  ['Role Play', 'PROXY', 'the number at index (smallest number % number of numbers)', b => b[min(b) % b.length]],
  ['Trick', 'SWAP', 'the list with the smallest and the largest numbers swapped', b => { const i = b.indexOf(min(b)), j = b.indexOf(max(b)); return b.map((x, k) => (k === i ? b[j] : k === j ? b[i] : x)) }],
  ['Destiny Bond', 'HAUNT', 'the last number, repeated as many times as there are numbers', b => b.map(() => b.at(-1))],
  ['Grudge', 'GRUDGE', 'the number of numbers minus the index of the largest', b => b.length - b.indexOf(max(b))],
  ['Nightmare', 'NIGHTMARE', 'the sum of the numbers hidden in the middle (all but the first and the last)', b => sum(b.slice(1, -1))],
  ['Drill Peck', 'DRILL', 'each number times 100, divided by the largest, rounded down (the largest becomes 100)', b => b.map(x => Math.floor((x * 100) / max(b)))],
  ['Mirror Move', 'RELAY', "the numbers joined into one string with ',' between them", b => b.join(',')],
  ['Megahorn', 'OVERFLOW', 'every number plus 1, except the last, which stays', b => b.map((x, i) => (i === b.length - 1 ? x : x + 1))],
  ['Pin Missile', 'DOUBLEFREE', 'the numbers without the first one, with the last one repeated at the end', b => [...b.slice(1), b.at(-1)]],
  ['Silver Wind', 'GLITTER', 'the list with the number at index 1 (the second) removed', b => b.filter((_, i) => i !== 1)],
  ['Spikes', 'SPIKES', 'each number mod 3', b => b.map(x => x % 3)],
  ['Will O Wisp', 'FLICKER', 'every number plus 5', b => b.map(x => x + 5)],
  ['Flatter', 'FLATTER', 'the last number that is under 100 (-1 if none)', b => b.findLast(x => x < 100) ?? -1],
  // FIRE — writes
  ['Ember', 'BURNDISC', 'every number plus 1', b => b.map(x => x + 1)],
  ['Fire Spin', 'HOTLOOP', 'every number plus its index (the first +0, the second +1…)', b => b.map((x, i) => x + i)],
  ['Flamethrower', 'OVERWRITE', 'every number replaced by the first number, except the first, which becomes the last', b => b.map((_, i) => (i === 0 ? b.at(-1) : b[0]))],
  ['Flame Wheel', 'HOTSWAP', 'the list with every pair of neighbours swapped ([1, 2, 3, 4, 5] → [2, 1, 4, 3, 5])', b => b.map((x, i, a) => (i % 2 === 0 ? (i + 1 < a.length ? a[i + 1] : x) : a[i - 1]))],
  ['Heat Wave', 'THERMAL', 'every number plus the largest number', b => b.map(x => x + max(b))],
  // WATER — flow
  ['Water Gun', 'FLUSH', 'an empty list', () => []],
  ['Water Pulse', 'FILTER', 'the numbers that are 50 or more (the ones under 50 dropped)', b => b.filter(x => x >= 50)],
  ['Withdraw', 'BUFFER', 'the last 3 numbers', b => b.slice(-3)],
  ['Bubble', 'DRIP', 'every second number starting from the second one: the numbers at positions 1, 3, 5… counting from 0', b => b.filter((_, i) => i % 2 === 1)],
  ['Water Sport', 'THROTTLE', 'the numbers that are 100 or less, in their order', b => b.filter(x => x <= 100)],
  ['Bubble Beam', 'STREAM', 'the numbers from the start up to (not including) the first one over 100; all of them if none is', b => { const i = b.findIndex(x => x > 100); return i < 0 ? [...b] : b.slice(0, i) }],
  ['Rain Dance', 'DRAIN PIPE', 'the numbers with the smallest one removed (the first smallest, if tied)', b => { const i = b.indexOf(min(b)); return b.filter((_, j) => j !== i) }],
  ['Hydro Pump', 'FIREHOSE', 'the numbers over 100, then the numbers 100 or under, each group in its order', b => [...b.filter(x => x > 100), ...b.filter(x => x <= 100)]],
  // GRASS — grow and gather
  ['Vine Whip', 'CRAWL', 'the numbers at even indexes (0, 2, 4…)', b => b.filter((_, i) => i % 2 === 0)],
  ['Sleep Powder', 'SLEEP', 'the average number, rounded down', b => Math.floor(sum(b) / b.length)],
  ['Spore', 'STANDBY', 'one flat list where each number appears twice in a row ([1, 2] → [1, 1, 2, 2]; not a list of pairs)', b => b.flatMap(x => [x, x])],
  ['Razor Leaf', 'SHARDS', 'the numbers split into two halves, as a list of two lists (the first half is half the length, rounded down)', b => [b.slice(0, Math.floor(b.length / 2)), b.slice(Math.floor(b.length / 2))]],
  ['Stun Spore', 'STALL', 'how many numbers are under 50', b => b.filter(x => x < 50).length],
  ['Absorb', 'SCRAPE', 'half the sum, rounded down', b => Math.floor(sum(b) / 2)],
  ['Leech Seed', 'LEECH SEED', 'the sum of the numbers at even indexes (0, 2, 4…)', b => sum(b.filter((_, i) => i % 2 === 0))],
  ['Mega Drain', 'SIPHON', 'the sum of the numbers at odd indexes (1, 3, 5…)', b => sum(b.filter((_, i) => i % 2 === 1))],
  ['Giga Drain', 'HARVEST', 'the sum of the 3 largest numbers', b => sum(asc(b).slice(-3))],
  ['Solar Beam', 'SUNBURST', 'the sum of all the numbers times 2', b => sum(b) * 2],
  ['Synthesis', 'REGROW', 'the numbers with each one repeated as many times as its index + 1 ([5, 7] → [5, 7, 7])', b => b.flatMap((x, i) => Array(i + 1).fill(x))],
  ['Ingrain', 'ROOT', 'the first number, repeated as many times as there are numbers', b => b.map(() => b[0])],
  ['Aromatherapy', 'CLEANUP', 'the numbers that are multiples of 10, in their order', b => b.filter(x => x % 10 === 0)],
  // ELECTRIC — peaks
  ['Thunder Wave', 'POWERCUT', 'the numbers in their order, without the largest one', b => { const i = b.indexOf(max(b)); return b.filter((_, j) => j !== i) }],
  ['Spark', 'SPARK', 'a spark: a list of 4096 numbers, 4 frames of 1024: a jagged lightning bolt from the top row to the bottom row, white-hot (15) in the middle and dimmer at its edges, a different bolt in each frame', PAYLOAD.spark],
  ['Thunder Shock', 'SURGE', 'the largest number plus 1', b => max(b) + 1],
  ['Charge', 'CHARGE', 'the largest number times 2', b => max(b) * 2],
  ['Thunderbolt', 'SPIKE', 'the two largest numbers, largest first', b => asc(b).reverse().slice(0, 2)],
  ['Shock Wave', 'SHORT', 'the largest number minus the smallest', b => max(b) - min(b)],
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
  ['Mud Shot', 'FLOOR', 'each number rounded down to a multiple of 10 (47 → 40)', b => b.map(x => Math.floor(x / 10) * 10)],
  ['Mud Slap', 'SMEAR', 'each number mod 5', b => b.map(x => x % 5)],
  ['Dig', 'TUNNEL', 'the smallest number', b => min(b)],
  ['Bone Club', 'CLUB', 'each number divided by 3, rounded down', b => b.map(x => Math.floor(x / 3))],
  ['Bonemerang', 'BOOMERANG', 'the numbers, then the numbers again in reverse (there and back)', b => [...b, ...[...b].reverse()]],
  ['Sand Tomb', 'QUICKSAND', 'each number capped at the first number (numbers over the first become the first)', b => b.map(x => Math.min(x, b[0]))],
  // FLYING — distribute
  ['Peck', 'FETCH', 'the numbers as a JSON string, like [42,13,140]', b => JSON.stringify(b)],
  ['Wing Attack', 'UPLOAD', "the numbers joined into one string with '-' between them", b => b.join('-')],
  ['Aerial Ace', 'SHRINK', 'every number halved, rounded down', b => b.map(x => Math.floor(x / 2))],
  ['Gust', 'BROADCAST', 'a list as long as the input where every entry is the first number', b => b.map(() => b[0])],
  ['Feather Dance', 'DAMPEN', 'every number divided by 4, rounded down', b => b.map(x => Math.floor(x / 4))],
  // PSYCHIC — inspect
  ['Hypnosis', 'SUSPEND', 'the index of the largest number', b => b.indexOf(max(b))],
  ['Kinesis', 'GLITCH', "each number's last digit", b => b.map(x => x % 10)],
  ['Confusion', 'SCRAMBLE', 'the numbers sorted from largest to smallest', b => asc(b).reverse()],
  ['Psybeam', 'SMUDGE', 'every number rounded to the nearest 10 (5 rounds up)', b => b.map(x => Math.round(x / 10) * 10)],
  ['Reflect', 'REFLECT', 'each number mirrored around 100: 200 minus the number', b => b.map(x => 200 - x)],
  ['Teleport', 'SSH', 'the largest number', b => max(b)],
  ['Psychic', 'PROFILE', 'the numbers sorted from smallest to largest, then the largest removed', b => asc(b).slice(0, -1)],
  ['Agility', 'TURBO', 'the index of the second-largest number', b => { const s = asc(b); return b.indexOf(s[s.length - 2]) }],
  ['Calm Mind', 'IDLE', 'the median: the middle number of the sorted list (the lower middle for an even count)', b => asc(b)[Math.floor((b.length - 1) / 2)]],
  ['Meditate', 'LINT', 'how many numbers are greater than the first number', b => b.filter(x => x > b[0]).length],
  ['Dream Eater', 'DAEMON', 'the sum of the numbers under 100', b => sum(b.filter(x => x < 100))],
  ['Future Sight', 'FORECAST', 'the largest number plus the number of numbers', b => max(b) + b.length],
  // BUG — introduce bugs
  ['Leech Life', 'LEAK', 'the sum of the last two numbers', b => b.at(-1) + b.at(-2)],
  ['String Shot', 'SKIP', 'the list with its first number added again at the end', b => [...b, b[0]]],
  ['Twineedle', 'DOUBLE', 'the first number, twice (a list of two)', b => [b[0], b[0]]],
  // ROCK — raw bytes
  ['Rock Throw', 'BOOT', 'the sum of the numbers', b => sum(b)],
  ['Rock Tomb', 'BRICK', 'the numbers sorted from smallest to largest', b => asc(b)],
  ['Rollout', 'ROLLOUT', 'the running totals (first number, first two summed, first three…)', b => b.map((_, i) => sum(b.slice(0, i + 1)))],
  ['Rock Blast', 'BUCKSHOT', 'the sum of the 2 smallest numbers', b => sum(asc(b).slice(0, 2))],
  // GHOST — peek at what is hidden
  ['Astonish', 'POPUP', 'the numbers except the first and the last (the ones hidden in the middle)', b => b.slice(1, -1)],
  ['Confuse Ray', 'PEEK', 'the number hidden at index 2 (the third one)', b => b[2]],
  ['Lick', 'SNOOP', 'the number hidden at index 1 (the second one) plus the last number', b => b[1] + b.at(-1)],
  ['Night Shade', 'SHADOW', 'the number of numbers times 3', b => b.length * 3],
  ['Shadow Punch', 'GHOSTWRITE', 'the number at index (number of numbers − 2)', b => b[b.length - 2]],
  ['Spite', 'SPITE', 'the second-largest number', b => asc(b)[b.length - 2]],
  // DRAGON — absolute
  ['Dragon Rage', 'MELTDOWN', 'the length of the list times 10', b => b.length * 10],
  ['Dragon Breath', 'FLAMEOUT', 'always 60', () => 60],
  ['Twister', 'CYCLONE', 'always the list [40, 40]', () => [40, 40]],
  // DARK — pick by credential
  ['Bite', 'PHISH', 'the second-to-last number', b => b.at(-2)],
  ['Pursuit', 'TRACE', 'the index of the first number over 100 (-1 if none)', b => b.findIndex(x => x > 100)],
  ['Faint Attack', 'BACKDOOR', 'the number at index (last number % number of numbers)', b => b[b.at(-1) % b.length]],
  // STEEL — cipher
  ['Metal Claw', 'HASH', 'the sum of the numbers mod 256', b => sum(b) % 256],
  ['Metal Sound', 'JAMMER', 'every number XOR 255', b => b.map(x => x ^ 255)],
  // ??? — curse
  ['Curse', 'ROOTKIT', 'every number minus the smallest', b => b.map(x => x - min(b))],
]

/** A short way to say what a move's code returns, for the page (the starter card) when the spec is long. The ROM's
 *  summary screen keeps FireRed's own descriptions (owner, 2026-10-12). */
export const BRIEF = {
  DIM: 'a soft, round voice its lullaby is sung in',
  ERROR: 'a glitchy growl, played as its cry',
  FEEDBACK: 'a thin, ringing voice for its rings',
  BUZZ: 'a rough, buzzing voice for its booms',
  FLASH: 'a flash: 4 frames of a bright core with rays',
  SPARK: 'a spark: 4 frames of a jagged bolt',
  DEADLOCK: 'the middle number (index: the count halved, rounded down)',
  DISTORTION: 'the second half of the numbers (the split rounded down)',
  MINIMIZE: 'the list without its middle number (index: count halved)',
  ECHO: 'the sum of all the numbers, then the sum of that total\'s digits',
  UPGRADE: 'the list with its length added as one more number at the end',
  BLOOM: 'the sum of the numbers at indexes 0, 3, 6 and so on',
  SHIELD: 'the numbers at or above the average (rounded down)',
  LOCK: 'how many numbers are greater than the one before them',
  NIGHTMARE: 'the sum of all the numbers but the first and the last',
  DRILL: 'each number times 100 over the largest, rounded down',
  DOUBLEFREE: 'the list without its first number, its last one repeated',
  OVERWRITE: 'every number replaced by the first; the first by the last',
  HOTSWAP: 'the list with each pair of neighbours swapped',
  DRIP: 'the numbers at odd indexes (1, 3, 5 and so on)',
  STREAM: 'the numbers up to the first one over 100 (not it)',
  'DRAIN PIPE': 'the list with its smallest number removed',
  FIREHOSE: 'the numbers over 100 first, then the rest, each in order',
  STANDBY: 'one list with every number repeated twice in a row',
  SHARDS: 'a list of two lists: the first half, then the second half',
  REGROW: 'each number repeated its index plus one times',
  QUICKSAND: 'each number capped at the first number',
  IDLE: 'the median: the middle of the sorted list (the lower one)',
  ROLLOUT: 'the running totals: the first, the first two, and so on',
  POPUP: 'the numbers between the first and the last',
  SNOOP: 'the number at index 1 plus the last number',
  MORPH: 'the indexes of the numbers: 0, 1, 2 and so on',
  CORRODE: 'every number minus its index (the first minus 0)',
  HOTLOOP: 'every number plus its index (the first plus 0)',
  FLOOR: 'each number rounded down to a multiple of 10',
  FETCH: 'the numbers as one JSON string (a bracketed list)',
  CYCLONE: 'always a list of two numbers: 40 and 40',
  GHOSTWRITE: 'the second-to-last number',
  LOOP: 'the counting numbers from 1 up to the length of the list',
}

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
