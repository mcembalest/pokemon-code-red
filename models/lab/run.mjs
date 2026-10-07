// Battle-mechanics lab: try several turn designs side by side on the Pokémon model, fast.
//   CLOUDFLARE_API_KEY=… CLOUDFLARE_ACCOUNT_ID=… node lab/run.mjs lab/run.json out.json
// A variant = how a turn is put to the Pokémon + how its code is judged. Same moves, foes and seeds for all.
import { readFileSync, writeFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import { extractCode, gameModels, modelRef, renderDeclarations, runBlock } from '../../kernel/index.mjs'
import { rng } from '../contracts.mjs'
import { MOVES, byName } from '../battle/moves.mjs'
import { FOES, TYPES, cleanBytes, dirty } from '../battle/types.mjs'
import { EXAMPLE_BYTES, FORMATS, example, show } from './formats.mjs'
import { VARIANTS } from './variants.mjs'

const cfg = JSON.parse(readFileSync(process.argv[2] ?? 'lab/run.json', 'utf8'))
const outFile = process.argv[3] ?? 'lab-results.json'
const log = (...a) => console.error(...a)
const models = gameModels()

/** One foe: types, clean bytes, and the junk version (for the clean-rule variants). */
function makeFoe(seed, types) {
  const r = rng(seed)
  const pool = FOES.filter(([, t]) => t.join('/') === types.join('/'))
  const [name, , lo, hi] = pool.length ? pool[Math.floor(r() * pool.length)] : [types[0], types, 5, 15]
  const clean = cleanBytes(r, types)
  const level = lo + Math.floor(r() * (hi - lo + 1))
  return { name, level, types, clean, dirty: dirty(r, types, clean) }
}

async function ask(model, system, user) {
  const m = models.getModel('cloudflare-workers-ai', model)
  const t0 = Date.now()
  const reply = await models.completeSimple(m, { systemPrompt: system, messages: [{ role: 'user', content: user, timestamp: Date.now() }] }, { temperature: cfg.temperature ?? 0.7, maxTokens: cfg.maxTokens ?? 500 })
  const text = (reply.content ?? []).filter(c => c.type === 'text').map(c => c.text).join('').trim()
  return { text, ms: Date.now() - t0, error: reply.stopReason === 'error' ? reply.errorMessage : null }
}

async function episode({ model, variant, move, types, seed, memory, budget }) {
  const foe = makeFoe(seed, types)
  const v = VARIANTS[variant]
  let { system, user } = v.prompt({ move, foe, memory: memory ? memory(move, types) : '' })
  if (budget) user += `\n- Byte budget: your whole code block must be at most ${budget} characters, comments included.`
  let res
  try { res = await ask(model, system, user) } catch (e) { res = { text: '', error: String(e.message ?? e) } }
  if (res.error) return { outcome: 'miss', reason: 'api: ' + res.error.slice(0, 120) }
  const { code, reason } = extractCode(res.text)
  if (code === null) return { outcome: 'miss', reason, ms: res.ms }
  if (budget && code.length > budget) return { outcome: 'miss', reason: 'over byte budget', ms: res.ms, codeLen: code.length, code: code.slice(0, 700) }
  const verdict = await v.judge({ move, foe, code })
  return { ...verdict, ms: res.ms, codeLen: code.length, code: code.slice(0, 700) }
}

async function pool(jobs, n, fn) {
  const out = new Array(jobs.length); let i = 0
  await Promise.all(Array.from({ length: n }, async () => { while (i < jobs.length) { const k = i++; out[k] = await fn(jobs[k]) } }))
  return out
}

const rate = rows => +(rows.filter(r => r.outcome === 'hit').length / Math.max(1, rows.length)).toFixed(3)
const reasons = rows => { const o = {}; for (const r of rows) if (r.outcome === 'miss') { const k = (r.reason ?? '?').split(':')[0].slice(0, 40); o[k] = (o[k] ?? 0) + 1 } return o }

const results = { at: new Date().toISOString(), cfg, cells: [] }
const save = () => writeFileSync(outFile, JSON.stringify(results, null, 1))
for (const exp of cfg.experiments) {
  const moves = exp.moves === 'all' ? MOVES : exp.moves.map(n => byName[n])
  const typeSets = exp.types.map(s => s.split('/'))
  for (const model of exp.models ?? cfg.models) for (const variant of exp.variants) {
    const jobs = moves.flatMap(move => typeSets.flatMap(types => Array.from({ length: exp.samples }, (_, i) => ({ model, variant, move, types, budget: exp.budget, seed: 70000 + i * 131 + types.join().length }))))
    let memory = null
    if (exp.memory) {
      // warm-up on other seeds → per move: its shortest code that hit (the Pokémon's own library)
      const warm = await pool(moves.flatMap(move => typeSets.flatMap(types => Array.from({ length: exp.memory }, (_, i) => ({ model, variant, move, types, budget: exp.budget, seed: 990000 + i * 17 + types.join().length })))), cfg.concurrency ?? 8,
        async j => ({ move: j.move.name, types: j.types.join('/'), ...(await episode(j)) }))
      // the Pokémon's own notes: its shortest working code per move, and per foe type (how it read that data)
      const best = rows => rows.filter(r => r.outcome === 'hit').sort((a, b) => a.codeLen - b.codeLen)[0]
      const byMove = Object.fromEntries(moves.map(m => [m.name, best(warm.filter(r => r.move === m.name))]))
      const byType = Object.fromEntries(typeSets.map(t => [t[0], best(warm.filter(r => r.types.split('/')[0] === t[0]))]))
      memory = (move, types) => [
        byMove[move.name] && `My ${move.name} that worked (vs ${byMove[move.name].types}):\n\`\`\`js\n${byMove[move.name].code}\n\`\`\``,
        byType[types[0]] && byType[types[0]] !== byMove[move.name] && `How I read ${types[0]} data last time (in ${byType[types[0]].move}):\n\`\`\`js\n${byType[types[0]].code}\n\`\`\``,
      ].filter(Boolean).join('\n')
    }
    const t0 = Date.now()
    const rows = await pool(jobs.map(j => ({ ...j, memory })), cfg.concurrency ?? 8, async j => ({ move: j.move.name, types: j.types.join('/'), seed: j.seed, ...(await episode(j)) }))
    const cell = {
      exp: exp.name, model: model.split('/').pop(), variant, memory: !!exp.memory, budget: exp.budget ?? null, n: rows.length, hit: rate(rows), reasons: reasons(rows), wallS: Math.round((Date.now() - t0) / 1000),
      p50ms: rows.map(r => r.ms ?? 0).sort((a, b) => a - b)[Math.floor(rows.length / 2)],
      codeLen: Math.round(rows.filter(r => r.codeLen).reduce((a, r) => a + r.codeLen, 0) / Math.max(1, rows.filter(r => r.codeLen).length)),
      perMove: Object.fromEntries(moves.map(m => [m.name, rate(rows.filter(r => r.move === m.name))])),
      perType: Object.fromEntries(typeSets.map(t => [t.join('/'), rate(rows.filter(r => r.types === t.join('/')))])),
      misses: (() => { const seen = {}; return rows.filter(r => r.outcome === 'miss' && (seen[r.move] = (seen[r.move] ?? 0) + 1) <= 2) })(),
      hits: rows.filter(r => r.outcome === 'hit').slice(0, 6),
    }
    results.cells.push(cell); save()
    log(`${cell.exp} | ${cell.model} | ${variant}${cell.memory ? '+mem' : ''} | hit ${cell.hit} n=${cell.n} ${cell.wallS}s | ${JSON.stringify(cell.reasons)}`)
  }
}
results.done = true; save()
