// Can a small model "play" a high-level Pokémon if the harness gives it more?
// Grid: model × scaffold. Scaffolds (no training):
//   memory  — always-in-context notes from its own past battles (working code it wrote; moves it missed)
//   retries — when its code crashes, it sees the error and rewrites (same move, more bytes spent)
//   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… node scaffold.mjs scaffold.json > results.json
import { readFileSync } from 'node:fs'
import { promptFor, scoreCompletion, extractCode } from './evaluate.mjs'
import { makeFoe } from './contracts.mjs'

const MOVES = ['SCRATCH', 'TACKLE', 'GROWL', 'TAIL WHIP']
const cfg = JSON.parse(readFileSync(process.argv[2] ?? 'scaffold.json', 'utf8'))
const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account } = process.env
const api = `https://api.cloudflare.com/client/v4/accounts/${account}/ai`
const log = (...a) => console.error(...a)

async function chat(model, messages) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(`${api}/run/${model}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messages, max_tokens: cfg.max_tokens ?? 300, temperature: cfg.temperature ?? 0.8 }) })
    const j = await r.json().catch(() => ({}))
    if (r.ok && j.success !== false) { const res = j.result; return typeof res?.response === 'string' ? res.response : (res?.choices?.[0]?.message?.content ?? '') }
    if (r.status === 429 || r.status >= 500) { await new Promise(res => setTimeout(res, 2000 * (attempt + 1))); continue }
    throw new Error(`${r.status} ${JSON.stringify(j.errors ?? j).slice(0, 200)}`)
  }
  throw new Error('retries exhausted')
}
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k) } }))
  return out
}

/** One move, with up to `retries` rewrites after a crash. */
async function attempt(model, move, seed, { memory = '', retries = 0 }) {
  const { system, user } = promptFor(move, { level: cfg.level ?? 5, foe: makeFoe(seed), memory, situational: !!cfg.situational })
  const messages = [{ role: 'system', content: system }, { role: 'user', content: user }]
  let score, completion = '', tries = 0
  for (; tries <= retries; tries++) {
    try { completion = await chat(model, messages) } catch (e) { return { outcome: 'miss', reason: 'api: ' + e.message, tries: tries + 1 } }
    score = await scoreCompletion({ move, seed, level: cfg.level ?? 5, completion, situational: !!cfg.situational })
    const crashed = score.outcome === 'miss' && /^(script|timeout)/.test(score.reason ?? '')
    if (!crashed || tries === retries) break
    messages.push({ role: 'assistant', content: completion }, { role: 'user', content: `Your code crashed: ${score.reason}. Fix it. Reply with only the code block.` })
  }
  return { outcome: score.outcome, reason: score.reason ?? null, tries: tries + 1, code: score.code ?? extractCode(completion).code ?? completion.slice(0, 400) }
}

/** Memory = notes from its own warm-up battles: shortest working code per move, and which moves it missed. */
async function buildMemory(model) {
  const rows = await pool(MOVES.flatMap(move => Array.from({ length: cfg.warmup }, (_, i) => ({ move, seed: 1000 + i }))), cfg.concurrency ?? 4,
    ({ move, seed }) => attempt(model, move, seed, {}).then(r => ({ move, ...r })))
  const notes = []
  for (const move of MOVES) {
    const mine = rows.filter(r => r.move === move)
    const wins = mine.filter(r => r.outcome !== 'miss' && r.code).sort((a, b) => a.code.length - b.code.length)
    const misses = mine.length - wins.length
    if (wins.length) notes.push(`- ${move} worked (${wins.length}/${mine.length} times). My best version:\n${'```js\n' + wins[0].code.trim() + '\n```'}`)
    else notes.push(`- ${move} missed every time so far (${misses}/${mine.length}). Read the task carefully; do exactly what it says.`)
  }
  return notes
}

/** Whole entries only, until the memory size limit is reached (a young Pokémon can't remember everything). */
const fit = (notes, limit) => { const out = []; let n = 0; for (const e of notes) { if (n + e.length + 1 > limit) continue; out.push(e); n += e.length + 1 } return out.join('\n') }

const rate = sel => Object.fromEntries(['miss', 'hit', 'crit'].map(k => [k, +(sel.filter(r => r.outcome === k).length / sel.length).toFixed(3)]))
const results = { at: new Date().toISOString(), cfg, cells: [] }
for (const model of cfg.models) {
  let memory = null
  for (const sc of cfg.scaffolds) {
    if (sc.memory && memory === null) { memory = await buildMemory(model).catch(e => (log('memory failed', e.message), [])); log(model, 'memory entries', memory.length, 'chars', memory.join('').length) }
    const mem = sc.memory ? fit(memory, sc.memory_chars ?? cfg.memory_chars ?? 2000) : ''
    const jobs = MOVES.flatMap(move => Array.from({ length: cfg.samples }, (_, i) => ({ move, seed: 100000 + i })))
    const t0 = Date.now()
    const rows = await pool(jobs, cfg.concurrency ?? 4, ({ move, seed }) => attempt(model, move, seed, { memory: mem, retries: sc.retries ?? 0 }).then(r => ({ move, ...r })))
    const cell = { model, scaffold: sc.name, all: rate(rows), perMove: Object.fromEntries(MOVES.map(m => [m, rate(rows.filter(r => r.move === m))])),
      avgTries: +(rows.reduce((a, r) => a + r.tries, 0) / rows.length).toFixed(2), wallS: Math.round((Date.now() - t0) / 1000), memoryChars: mem.length, memory: mem || undefined }
    results.cells.push(cell)
    log(`${model.split('/').pop()} [${sc.name}] ${JSON.stringify(cell.all)} tries ${cell.avgTries}`)
  }
}
process.stdout.write(JSON.stringify(results, null, 2))
