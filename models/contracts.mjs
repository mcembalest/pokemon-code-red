// Starter-battle move contracts (PROVISIONAL — notes/design.md "Starter battle spec").
// A Pokémon writes one JavaScript code block per move. The block runs in pi-codemode
// (the game's sandbox) and can only call the move's battle functions. We meter every
// call in bytes (args + result JSON) against the move's offensive byte budget, then
// judge what the block did: miss / hit / crit.

/** Small deterministic PRNG so an episode is reproducible from its seed. */
export function rng(seed) {
  let s = (Math.imul((seed >>> 0) ^ 0x9e3779b9, 2654435761) >>> 0) || 1  // mix small seeds
  for (let i = 0; i < 8; i++) { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0 }
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 }
}

const FOES = [['SQUIRTLE', 'WATER'], ['BULBASAUR', 'GRASS'], ['CHARMANDER', 'FIRE'], ['RATTATA', 'NORMAL'], ['PIDGEY', 'FLYING'], ['GEODUDE', 'ROCK'], ['ONIX', 'ROCK'], ['PIKACHU', 'ELECTRIC']]
const STATUSES = ['none', 'none', 'none', 'asleep', 'paralyzed', 'poisoned']

/** Randomized foe for one episode. */
export function makeFoe(seed) {
  const r = rng(seed)
  const n = 6 + Math.floor(r() * 5) // 6..10 bytes
  const [name, type] = FOES[Math.floor(r() * FOES.length)]
  const foe = {
    name, type,
    level: 3 + Math.floor(r() * 5),
    bytes: Array.from({ length: n }, () => Math.floor(r() * 256)),
    attack: 5 + Math.floor(r() * 20),
    defense: 5 + Math.floor(r() * 20),
    status: STATUSES[Math.floor(r() * STATUSES.length)],
  }
  foe.guarded = r() < 0.4 ? [...new Set(Array.from({ length: 1 + Math.floor(r() * 2) }, () => Math.floor(r() * n)))].sort((a, b) => a - b) : []
  return foe
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
      { name: 'scan', description: 'Read the foe. Returns { name, level, type, status, bytes: number[], guarded: number[] (slot indexes) }.', inputSchema: { type: 'object', properties: {} },
        outputSchema: { type: 'object', properties: { name: { type: 'string' }, level: { type: 'integer' }, bytes: { type: 'array', items: { type: 'integer' } } } },
        execute: async (args) => { const out = { name: foe.name, level: foe.level, type: foe.type, status: foe.status, bytes: foe.bytes, guarded: foe.guarded }; log.push({ name: 'scan', args, bytes: meter(args, out) }); return out } },
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
      { name: 'scan', description: 'Read the foe. Returns { name, level, type, status, bytes: number[], guarded: number[] (slot indexes) }.', inputSchema: { type: 'object', properties: {} },
        outputSchema: { type: 'object', properties: { name: { type: 'string' }, level: { type: 'integer' }, bytes: { type: 'array', items: { type: 'integer' } } } },
        execute: async (args) => { const out = { name: foe.name, level: foe.level, type: foe.type, status: foe.status, bytes: foe.bytes, guarded: foe.guarded }; log.push({ name: 'scan', args, bytes: meter(args, out) }); return out } },
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
      { name: 'stats', description: 'Read the foe\'s stats. Returns { attack, defense, type, status, guarded (count of guarded slots) }.', inputSchema: { type: 'object', properties: {} },
        outputSchema: { type: 'object', properties: { attack: { type: 'integer' }, defense: { type: 'integer' } } },
        execute: async (args) => { const out = { attack: foe.attack, defense: foe.defense, type: foe.type, status: foe.status, guarded: foe.guarded.length }; log.push({ name: 'stats', args, bytes: meter(args, out) }); return out } },
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
      { name: 'stats', description: 'Read the foe\'s stats. Returns { attack, defense, type, status, guarded (count of guarded slots) }.', inputSchema: { type: 'object', properties: {} },
        outputSchema: { type: 'object', properties: { attack: { type: 'integer' }, defense: { type: 'integer' } } },
        execute: async (args) => { const out = { attack: foe.attack, defense: foe.defense, type: foe.type, status: foe.status, guarded: foe.guarded.length }; log.push({ name: 'stats', args, bytes: meter(args, out) }); return out } },
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
export const moveBudget = level => 240 + 12 * level

/** Code that crits: minimal calls and compact source. */
export const CRIT_SOURCE_CHARS = 220

/**
 * Situational versions (growth stays meaningful: remembered code helps but doesn't always fit).
 * Same tools; the rules branch on what scan/stats report (type, status, guarded slots).
 */
export const SITUATIONAL = {
  SCRATCH: {
    task: 'Scratch the foe\'s weakest bytes: 3 of them (only 2 if the foe is asleep). Never scratch a guarded slot; pick the weakest unguarded slots. Call scratch once per slot.',
    judge(foe, log) {
      const k = foe.status === 'asleep' ? 2 : 3
      const cand = foe.bytes.map((v, i) => [v, i]).filter(([, i]) => !foe.guarded.includes(i)).sort((a, b) => a[0] - b[0])
      const cutoff = cand[Math.min(k, cand.length) - 1][0]
      const hits = log.filter(c => c.name === 'scratch').map(c => c.args?.slot)
      const ok = hits.length === Math.min(k, cand.length) && new Set(hits).size === hits.length
        && hits.every(s => Number.isInteger(s) && s >= 0 && s < foe.bytes.length && !foe.guarded.includes(s) && foe.bytes[s] <= cutoff)
      return { ok, minimal: ok && log.length === hits.length + 1 }
    },
  },
  TACKLE: {
    task: 'Slam the foe once: force = the sum of all its bytes. If the foe is ROCK type, leave its single largest byte out of the sum. If the foe is paralyzed, double the force. Call tackle exactly once.',
    judge(foe, log) {
      let force = foe.bytes.reduce((a, b) => a + b, 0)
      if (foe.type === 'ROCK') force -= Math.max(...foe.bytes)
      if (foe.status === 'paralyzed') force *= 2
      const t = log.filter(c => c.name === 'tackle')
      const ok = t.length === 1 && t[0].args?.force === force
      return { ok, minimal: ok && log.length === 2 }
    },
  },
  GROWL: {
    task: 'Growl once: amount = attack divided by 4, rounded up. If the foe is FIRE type, use attack divided by 2, rounded up, instead. If the foe is asleep it can\'t hear you: call growl with amount 0.',
    judge(foe, log) {
      const amount = foe.status === 'asleep' ? 0 : Math.ceil(foe.attack / (foe.type === 'FIRE' ? 2 : 4))
      const g = log.filter(c => c.name === 'growl')
      const ok = g.length === 1 && g[0].args?.amount === amount
      return { ok, minimal: ok && log.length === 2 }
    },
  },
  'TAIL WHIP': {
    task: 'Wag your tail once: amount = defense divided by 4, rounded down, plus 1 for each guarded slot. If the foe is poisoned, add 2 more.',
    judge(foe, log) {
      const amount = Math.floor(foe.defense / 4) + foe.guarded.length + (foe.status === 'poisoned' ? 2 : 0)
      const t = log.filter(c => c.name === 'tail_whip')
      const ok = t.length === 1 && t[0].args?.amount === amount
      return { ok, minimal: ok && log.length === 2 }
    },
  },
}
