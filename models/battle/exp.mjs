// Battle rule experiment (draft rules, 2026-10-07): can the Pokémon model do each move against each foe type?
//   A: every move vs. NORMAL foes (the move's own difficulty)
//   B: chosen moves vs. every foe type combination before Misty (the cleanup's difficulty)
// Runs on the game kernel (../../kernel): one fresh battle per episode, code block replies, no memory.
//   CLOUDFLARE_API_KEY=… CLOUDFLARE_ACCOUNT_ID=… node battle/exp.mjs battle/exp.json battle-results.json
import { readFileSync, writeFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import { gameModels, modelRef, openKernel } from '../../kernel/index.mjs'
import { rng } from '../contracts.mjs'
import { MOVES, byName } from './moves.mjs'
import { FOES, TYPES, cleanBytes, dirty } from './types.mjs'

const cfg = import.meta.url === `file://${process.argv[1]}` ? JSON.parse(readFileSync(process.argv[2] ?? 'battle/exp.json', 'utf8')) : {}
let save
const outFile = process.argv[3] ?? 'battle-results.json'
const log = (...a) => console.error(...a)
const budget = level => 240 + 12 * level

/** One foe for one episode. */
export function makeFoe(seed, types) {
  const r = rng(seed)
  const pool = FOES.filter(([, t]) => t.join('/') === types.join('/'))
  const [name, , lo, hi] = pool[Math.floor(r() * pool.length)]
  const clean = cleanBytes(r, types)
  const level = lo + Math.floor(r() * (hi - lo + 1))
  return { scan: { name, level, types, status: 'none', bytes: dirty(r, types, clean) }, clean }
}

export function turnText(move, foe) {
  const clean = foe.types.map((t, i) => `${i ? 'then ' : ''}${t}: ${TYPES[t].rule}`).join('; ')
  const call = move.shape === 'no key' ? `await tools.${move.fn}()` : `await tools.${move.fn}({ key })`
  return {
    foeLine: `Foe: ${foe.name} Lv${foe.level} (${foe.types.join('/')}).`,
    task: [
      '', 'Steps:',
      '1. const foe = await tools.scan()',
      `2. Clean foe.bytes (${clean}).`,
      move.shape === 'no key' ? `3. ${move.spec}.` : `3. key = ${move.spec}, from the cleaned bytes (${move.shape}).`,
      `4. ${call}, exactly once.`,
    ].join('\n'),
  }
}

export function tools(move, foe) {
  return [
    { name: 'scan', description: 'Read the foe. Returns { name, level, types, status, bytes }.', inputSchema: { type: 'object', properties: {} },
      outputSchema: { type: 'object', properties: { name: { type: 'string' }, level: { type: 'integer' }, types: { type: 'array', items: { type: 'string' } }, status: { type: 'string' }, bytes: { type: 'array' } } },
      execute: async () => structuredClone(foe) },
    { name: move.fn, description: `${move.name}: strike the foe with your answer as key.`, inputSchema: { type: 'object', properties: { key: {} } },
      outputSchema: { type: 'string' }, execute: async () => 'ok' },
  ]
}

export function judge(move, foe, clean, result, level) {
  if (!result.run) return { outcome: 'miss', reason: result.reason }
  if (!result.run.ok) return { outcome: 'miss', reason: result.reason }
  const strikes = result.run.log.filter(c => c.name === move.fn)
  if (strikes.length !== 1) return { outcome: 'miss', reason: strikes.length ? 'struck more than once' : 'never struck' }
  if (result.run.spent > budget(level)) return { outcome: 'miss', reason: 'over byte budget' }
  const want = move.ref(clean, foe)
  const got = strikes[0].args?.key
  return isDeepStrictEqual(got, want) ? { outcome: 'hit', reason: null } : { outcome: 'miss', reason: 'wrong answer', got: JSON.stringify(got)?.slice(0, 80), want: JSON.stringify(want)?.slice(0, 80) }
}

async function main() {
const kernel = await openKernel({ models: gameModels() })
const results = { at: new Date().toISOString(), cfg, runs: [] }
save = () => writeFileSync(outFile, JSON.stringify(results, null, 1))

async function pool(jobs, mons, fn) {
  const out = new Array(jobs.length); let i = 0
  await Promise.all(mons.map(async mon => { while (i < jobs.length) { const k = i++; out[k] = await fn(mon, jobs[k]) } }))
  return out
}

async function episode(mon, { model, move, types, seed }) {
  const { scan, clean } = makeFoe(seed, types)
  const level = scan.level
  await mon.update(m => { m.level = level })
  await mon.battle()
  let result
  try {
    result = await mon.useMove({ move: move.name, mode: 'block', model: modelRef(model), budget: budget(level), tools: tools(move, scan), ...turnText(move, scan) })
  } catch (e) { result = { reason: 'kernel: ' + String(e.message ?? e).slice(0, 160), run: null, code: null } }
  return { move: move.name, types: types.join('/'), seed, ...judge(move, scan, clean, result, level), ms: result.ms, code: result.code?.slice(0, 600) ?? null }
}

const rate = rows => +(rows.filter(r => r.outcome === 'hit').length / rows.length).toFixed(3)
const reasons = rows => { const o = {}; for (const r of rows) if (r.outcome === 'miss') { const k = (r.reason ?? '?').split(':')[0].slice(0, 40); o[k] = (o[k] ?? 0) + 1 } return o }

for (const model of cfg.models) {
  const mons = await Promise.all(Array.from({ length: cfg.concurrency ?? 6 }, () => kernel.createMon({ species: 'CHARMANDER', level: 5, memory: [], memoryLimit: 0 })))
  for (const part of cfg.parts) {
    if (part.models && !part.models.includes(model)) continue
    const moves = part.moves === 'all' ? MOVES : part.moves.map(n => byName[n])
    const combos = part.types === 'all' ? [...new Set(FOES.map(([, t]) => t.join('/')))].map(s => s.split('/')) : part.types.map(s => s.split('/'))
    let memoryChars = 0
    if (part.memory) {
      // Warm-up battles (other seeds) → notes: each move's shortest code that hit, or that it never hit yet.
      const warm = await pool(moves.flatMap(move => combos.flatMap(types => Array.from({ length: part.memory.warmup }, (_, i) => ({ model, move, types, seed: 900000 + i * 37 + types.length })))), mons, episode)
      const notes = moves.map(m => {
        const wins = warm.filter(r => r.move === m.name && r.outcome === 'hit' && r.code).sort((a, b) => a.code.length - b.code.length)
        return wins.length ? `- ${m.name} hit (${wins.length}/${warm.filter(r => r.move === m.name).length}). My best code:\n${'```js\n' + wins[0].code.trim() + '\n```'}`
          : `- ${m.name} never hit yet. Read the key spec and the type notes carefully.`
      })
      for (const mon of mons) await mon.update(st => { st.memory = notes; st.memoryLimit = part.memory.limit })
      memoryChars = notes.join('\n').length
    } else for (const mon of mons) await mon.update(st => { st.memory = []; st.memoryLimit = 0 })
    const jobs = moves.flatMap(move => combos.flatMap(types => Array.from({ length: part.samples }, (_, i) => ({ model, move, types, seed: 50000 + i * 101 + types.length }))))
    const t0 = Date.now()
    const rows = await pool(jobs, mons, episode)
    const run = {
      model, part: part.name, memoryChars, n: rows.length, hit: rate(rows), reasons: reasons(rows), wallS: Math.round((Date.now() - t0) / 1000),
      perMove: Object.fromEntries(moves.map(m => { const s = rows.filter(r => r.move === m.name); return [m.name, { hit: rate(s), reasons: reasons(s) }] })),
      perType: Object.fromEntries(combos.map(t => { const s = rows.filter(r => r.types === t.join('/')); return [t.join('/'), rate(s)] })),
      examples: rows.filter(r => r.outcome === 'miss').slice(0, 40),
    }
    results.runs.push(run); save()
    log(`${model.split('/').pop()} [${part.name}] hit ${run.hit} n=${run.n} ${run.wallS}s ${JSON.stringify(run.reasons)}`)
  }
}
results.done = true; save()
await kernel.close()
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
