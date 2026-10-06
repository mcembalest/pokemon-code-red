// Starter-battle move contracts (PROVISIONAL — notes/design.md "Starter battle spec").
// A Pokémon writes one JavaScript code block per move. The block runs in pi-codemode
// (the game's sandbox) and can only call the move's battle functions. We meter every
// call in bytes (args + result JSON) against the move's offensive byte budget, then
// judge what the block did: miss / hit / crit.

/** Small deterministic PRNG so an episode is reproducible from its seed. */
export function rng(seed) {
  let s = (seed >>> 0) || 1
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 }
}

const FOES = ['SQUIRTLE', 'BULBASAUR', 'CHARMANDER', 'RATTATA', 'PIDGEY']

/** Randomized foe for one episode. */
export function makeFoe(seed) {
  const r = rng(seed)
  const n = 6 + Math.floor(r() * 5) // 6..10 bytes
  return {
    name: FOES[Math.floor(r() * FOES.length)],
    level: 3 + Math.floor(r() * 5),
    bytes: Array.from({ length: n }, () => Math.floor(r() * 256)),
    attack: 5 + Math.floor(r() * 20),
    defense: 5 + Math.floor(r() * 20),
  }
}

const meter = (args, result) => JSON.stringify(args ?? {}).length + JSON.stringify(result ?? null).length

/**
 * Each contract: what the move must do, its battle functions, and a judge.
 * tools(foe, log) returns CodemodeTool[]; each call is pushed to `log` as { name, args, bytes }.
 */
export const CONTRACTS = {
  SCRATCH: {
    power: 40,
    task: 'Scratch the foe\'s 3 weakest bytes: read the foe, then call scratch once for each of the 3 lowest-valued slots.',
    tools: (foe, log) => [
      { name: 'scan', description: 'Read the foe. Returns { name, level, bytes: number[] }.', inputSchema: { type: 'object', properties: {} },
        outputSchema: { type: 'object', properties: { name: { type: 'string' }, level: { type: 'integer' }, bytes: { type: 'array', items: { type: 'integer' } } } },
        execute: async (args) => { const out = { name: foe.name, level: foe.level, bytes: foe.bytes }; log.push({ name: 'scan', args, bytes: meter(args, out) }); return out } },
      { name: 'scratch', description: 'Scratch one slot of the foe\'s bytes (index into bytes).', inputSchema: { type: 'object', properties: { slot: { type: 'integer' } }, required: ['slot'] },
        outputSchema: { type: 'string' },
        execute: async (args) => { const out = 'ok'; log.push({ name: 'scratch', args, bytes: meter(args, out) }); return out } },
    ],
    judge(foe, log) {
      const hits = log.filter(c => c.name === 'scratch').map(c => c.args?.slot)
      const sorted = foe.bytes.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0])
      const third = sorted[2][0]
      const ok = hits.length === 3 && new Set(hits).size === 3 && hits.every(s => Number.isInteger(s) && s >= 0 && s < foe.bytes.length && foe.bytes[s] <= third)
      return { ok, minimal: ok && log.length === 4 }
    },
  },
  TACKLE: {
    power: 35,
    task: 'Slam the foe with everything at once: read the foe, add up all of its bytes, then call tackle exactly once with that total as force.',
    tools: (foe, log) => [
      { name: 'scan', description: 'Read the foe. Returns { name, level, bytes: number[] }.', inputSchema: { type: 'object', properties: {} },
        outputSchema: { type: 'object', properties: { name: { type: 'string' }, level: { type: 'integer' }, bytes: { type: 'array', items: { type: 'integer' } } } },
        execute: async (args) => { const out = { name: foe.name, level: foe.level, bytes: foe.bytes }; log.push({ name: 'scan', args, bytes: meter(args, out) }); return out } },
      { name: 'tackle', description: 'Hit the foe once with the given force.', inputSchema: { type: 'object', properties: { force: { type: 'integer' } }, required: ['force'] },
        outputSchema: { type: 'string' },
        execute: async (args) => { const out = 'ok'; log.push({ name: 'tackle', args, bytes: meter(args, out) }); return out } },
    ],
    judge(foe, log) {
      const t = log.filter(c => c.name === 'tackle')
      const ok = t.length === 1 && t[0].args?.force === foe.bytes.reduce((a, b) => a + b, 0)
      return { ok, minimal: ok && log.length === 2 }
    },
  },
  GROWL: {
    power: 0,
    task: 'Growl to lower the foe\'s attack: read its stats, then call growl once with amount = attack divided by 4, rounded up.',
    tools: (foe, log) => [
      { name: 'stats', description: 'Read the foe\'s stats. Returns { attack, defense }.', inputSchema: { type: 'object', properties: {} },
        outputSchema: { type: 'object', properties: { attack: { type: 'integer' }, defense: { type: 'integer' } } },
        execute: async (args) => { const out = { attack: foe.attack, defense: foe.defense }; log.push({ name: 'stats', args, bytes: meter(args, out) }); return out } },
      { name: 'growl', description: 'Lower the foe\'s attack by amount.', inputSchema: { type: 'object', properties: { amount: { type: 'integer' } }, required: ['amount'] },
        outputSchema: { type: 'string' },
        execute: async (args) => { const out = 'ok'; log.push({ name: 'growl', args, bytes: meter(args, out) }); return out } },
    ],
    judge(foe, log) {
      const g = log.filter(c => c.name === 'growl')
      const ok = g.length === 1 && g[0].args?.amount === Math.ceil(foe.attack / 4)
      return { ok, minimal: ok && log.length === 2 }
    },
  },
  'TAIL WHIP': {
    power: 0,
    task: 'Wag your tail to lower the foe\'s defense: read its stats, then call tail_whip once with amount = defense divided by 4, rounded down.',
    tools: (foe, log) => [
      { name: 'stats', description: 'Read the foe\'s stats. Returns { attack, defense }.', inputSchema: { type: 'object', properties: {} },
        outputSchema: { type: 'object', properties: { attack: { type: 'integer' }, defense: { type: 'integer' } } },
        execute: async (args) => { const out = { attack: foe.attack, defense: foe.defense }; log.push({ name: 'stats', args, bytes: meter(args, out) }); return out } },
      { name: 'tail_whip', description: 'Lower the foe\'s defense by amount.', inputSchema: { type: 'object', properties: { amount: { type: 'integer' } }, required: ['amount'] },
        outputSchema: { type: 'string' },
        execute: async (args) => { const out = 'ok'; log.push({ name: 'tail_whip', args, bytes: meter(args, out) }); return out } },
    ],
    judge(foe, log) {
      const t = log.filter(c => c.name === 'tail_whip')
      const ok = t.length === 1 && t[0].args?.amount === Math.floor(foe.defense / 4)
      return { ok, minimal: ok && log.length === 2 }
    },
  },
}

/** Offensive byte budget per move by level (PROVISIONAL): what the block may spend on tool traffic. */
export const moveBudget = level => 120 + 12 * level

/** Code that crits: minimal calls and compact source. */
export const CRIT_SOURCE_CHARS = 220
