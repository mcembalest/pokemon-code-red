// Experiment on the real game kernel (pi-durable + pi-ai + pi-codemode; ../kernel).
// Grid: model × mode × memory. Each episode: a fresh battle for a Pokémon, one move, judged.
//   mode 'block' — the Pokémon replies with a code block
//   mode 'tool'  — the Pokémon calls pi's `code` tool (pi's code-mode convention)
//   memory      — always-in-context notes from its own warm-up battles (shortest working code; moves it missed)
//   CLOUDFLARE_API_KEY=… CLOUDFLARE_ACCOUNT_ID=… node kernel-exp.mjs kernel-exp.json > results.json
import { readFileSync } from 'node:fs'
import { gameModels, modelRef, openKernel } from '../kernel/index.mjs'
import { CONTRACTS, CRIT_SOURCE_CHARS, SITUATIONAL, makeFoe, moveBudget } from './contracts.mjs'

const MOVES = ['SCRATCH', 'TACKLE', 'GROWL', 'TAIL WHIP']
const cfg = JSON.parse(readFileSync(process.argv[2] ?? 'kernel-exp.json', 'utf8'))
const log = (...a) => console.error(...a)
const level = cfg.level ?? 5

/** Judge what the block did (the game's job, not the kernel's). */
export function judge({ move, foe, result, situational }) {
  if (!result.run) return { outcome: 'miss', reason: result.reason }
  if (!result.run.ok) return { outcome: 'miss', reason: result.reason }
  if (result.run.spent > moveBudget(level)) return { outcome: 'miss', reason: 'over byte budget' }
  const verdict = (situational ? SITUATIONAL[move] : CONTRACTS[move]).judge(foe, result.run.log)
  if (!verdict.ok) return { outcome: 'miss', reason: 'did not do the move\'s job' }
  return verdict.minimal && result.code.length <= CRIT_SOURCE_CHARS ? { outcome: 'crit', reason: null } : { outcome: 'hit', reason: null }
}

const kernel = await openKernel({ models: gameModels() })

async function episode(mon, { model, mode, move, seed }) {
  const foe = makeFoe(seed)
  await mon.battle()
  let result
  try {
    result = await mon.useMove({
      move, mode, model: modelRef(model), budget: moveBudget(level),
      task: (cfg.situational ? SITUATIONAL[move] : CONTRACTS[move]).task,
      tools: CONTRACTS[move].tools(foe, []), foeLine: `Foe: ${foe.name} Lv${foe.level}.`,
    })
  } catch (e) { result = { reason: 'kernel: ' + String(e.message ?? e).slice(0, 200), run: null, code: null, ms: 0 } }
  const j = judge({ move, foe, result, situational: !!cfg.situational })
  return { move, seed, ...j, ms: result.ms, code: result.code, reply: result.code ? undefined : (result.reply ?? '').slice(0, 300), tokens: result.usage?.totalTokens ?? null }
}

/** One Pokémon per worker slot (a conversation runs one move at a time). */
async function pool(jobs, mons, fn) {
  const out = new Array(jobs.length); let i = 0
  await Promise.all(mons.map(async mon => { while (i < jobs.length) { const k = i++; out[k] = await fn(mon, jobs[k]) } }))
  return out
}

const rate = sel => Object.fromEntries(['miss', 'hit', 'crit'].map(k => [k, +(sel.filter(r => r.outcome === k).length / sel.length).toFixed(3)]))
const results = { at: new Date().toISOString(), cfg, cells: [] }
for (const model of cfg.models) {
  for (const mode of cfg.modes) {
    const mons = await Promise.all(Array.from({ length: cfg.concurrency ?? 4 }, () => kernel.createMon({ species: 'CHARMANDER', level, memory: [], memoryLimit: 0 })))
    let notes = null
    for (const memoryLimit of cfg.memory) {
      if (memoryLimit > 0 && notes === null) {
        const warm = await pool(MOVES.flatMap(move => Array.from({ length: cfg.warmup }, (_, i) => ({ model, mode, move, seed: 1000 + i }))), mons, episode)
        notes = MOVES.map(move => {
          const mine = warm.filter(r => r.move === move)
          const wins = mine.filter(r => r.outcome !== 'miss' && r.code).sort((a, b) => a.code.length - b.code.length)
          return wins.length ? `- ${move} worked (${wins.length}/${mine.length} times). My best version:\n${'```js\n' + wins[0].code.trim() + '\n```'}`
            : `- ${move} missed every time so far (${mine.length}/${mine.length}). Read the task carefully; do exactly what it says.`
        })
      }
      for (const mon of mons) await mon.update(m => { m.memory = memoryLimit > 0 ? notes : []; m.memoryLimit = memoryLimit })
      const t0 = Date.now()
      const rows = await pool(MOVES.flatMap(move => Array.from({ length: cfg.samples }, (_, i) => ({ model, mode, move, seed: 100000 + i }))), mons, episode)
      const reasons = {}
      for (const r of rows) if (r.outcome === 'miss') { const k = (r.reason ?? '?').split(':')[0].slice(0, 50); reasons[k] = (reasons[k] ?? 0) + 1 }
      const ms = rows.map(r => r.ms).sort((a, b) => a - b)
      const cell = { model, mode, memoryLimit, all: rate(rows), perMove: Object.fromEntries(MOVES.map(m => [m, rate(rows.filter(r => r.move === m))])),
        missReasons: reasons, p50ms: ms[Math.floor(ms.length / 2)], wallS: Math.round((Date.now() - t0) / 1000),
        examples: rows.filter(r => r.outcome === 'miss').slice(0, 6) }
      results.cells.push(cell)
      log(`${model.split('/').pop()} [${mode} mem=${memoryLimit}] ${JSON.stringify(cell.all)} p50 ${cell.p50ms}ms ${JSON.stringify(reasons)}`)
    }
  }
}
await kernel.close()
process.stdout.write(JSON.stringify(results, null, 2))
