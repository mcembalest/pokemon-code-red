// Probe Cloudflare Workers AI models on the starter moves: how often does each model's
// code miss / hit / crit in the game sandbox? Picks the level ladder from data.
//   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… node probe.mjs probe.json > results.json
// Runs in CI (.github/workflows/models.yml); results → release `model-probe`.
import { readFileSync } from 'node:fs'
import { promptFor, scoreCompletion } from './evaluate.mjs'
import { makeFoe } from './contracts.mjs'

const MOVES = ['SCRATCH', 'TACKLE', 'GROWL', 'TAIL WHIP']
const cfg = JSON.parse(readFileSync(process.argv[2] ?? 'probe.json', 'utf8'))
const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account } = process.env
const api = `https://api.cloudflare.com/client/v4/accounts/${account}/ai`
const log = (...a) => console.error(...a)

async function cf(path, body) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(api + path, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    const j = await r.json().catch(() => ({}))
    if (r.ok && j.success !== false) return j.result
    if (r.status === 429 || r.status >= 500) { await new Promise(res => setTimeout(res, 2000 * (attempt + 1))); continue }
    throw new Error(`${r.status} ${JSON.stringify(j.errors ?? j).slice(0, 300)}`)
  }
  throw new Error('retries exhausted')
}

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k) } }))
  return out
}

const available = (await cf('/models/search?task=Text%20Generation&per_page=200')).map(m => m.name).sort()
log('text-generation models:', available.length)

const results = { at: new Date().toISOString(), level: cfg.level ?? 5, samples: cfg.samples, available, models: {} }
for (const model of cfg.models) {
  if (!available.includes(model)) { results.models[model] = { error: 'not in catalog' }; log(model, 'not in catalog'); continue }
  const jobs = MOVES.flatMap(move => Array.from({ length: cfg.samples }, (_, i) => ({ move, seed: 100000 + i })))
  const t0 = Date.now()
  const rows = await pool(jobs, cfg.concurrency ?? 4, async ({ move, seed }) => {
    const { system, user } = promptFor(move, { level: cfg.level ?? 5, foe: makeFoe(seed) })
    const t = Date.now()
    let completion = '', error = null
    try {
      const r = await cf(`/run/${model}`, { messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: cfg.max_tokens ?? 300, temperature: cfg.temperature ?? 0.8 })
      completion = typeof r?.response === 'string' ? r.response : (r?.choices?.[0]?.message?.content ?? JSON.stringify(r?.response ?? r ?? ''))
    } catch (e) { error = String(e.message ?? e) }
    const ms = Date.now() - t
    const score = error ? { outcome: 'miss', reason: 'api: ' + error } : await scoreCompletion({ move, seed, level: cfg.level ?? 5, completion })
    return { move, seed, ms, outcome: score.outcome, reason: score.reason ?? null, completion: completion.slice(0, 1200) }
  })
  const rate = sel => Object.fromEntries(['miss', 'hit', 'crit'].map(k => [k, +(sel.filter(r => r.outcome === k).length / sel.length).toFixed(3)]))
  const reasons = {}
  for (const r of rows) if (r.outcome === 'miss') { const k = (r.reason ?? '?').split(':')[0].slice(0, 40); reasons[k] = (reasons[k] ?? 0) + 1 }
  const ms = rows.map(r => r.ms).sort((a, b) => a - b)
  results.models[model] = {
    all: rate(rows), perMove: Object.fromEntries(MOVES.map(m => [m, rate(rows.filter(r => r.move === m))])),
    missReasons: reasons, latencyMs: { p50: ms[Math.floor(ms.length / 2)], p90: ms[Math.floor(ms.length * 0.9)] }, wallS: Math.round((Date.now() - t0) / 1000),
    examples: Object.fromEntries(MOVES.map(m => [m, rows.filter(r => r.move === m).slice(0, 3)])),
  }
  log(model, JSON.stringify(results.models[model].all), 'p50', results.models[model].latencyMs.p50, 'ms', JSON.stringify(reasons))
}
process.stdout.write(JSON.stringify(results, null, 2))
