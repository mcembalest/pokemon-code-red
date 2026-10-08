// Move table with the real model and the game's own prompt (rules/turnPrompt): P(hit | move, format, known reader).
// Feeds the strategy simulator (models/strategy) and keeps every reply for reading.
//   CLOUDFLARE_API_KEY=… CLOUDFLARE_ACCOUNT_ID=… node lab/moves.mjs lab/moves.json out.json
import { readFileSync, writeFileSync } from 'node:fs'
import { extractCode, gameModels, runBlock } from '../../kernel/index.mjs'
import { MOVES, WORDS, budgetAt, focusAt, judge, knowFor, rng, targetBytes, turnData, turnPrompt } from '../../rules/index.mjs'

const cfg = JSON.parse(readFileSync(process.argv[2] ?? 'lab/moves.json', 'utf8'))
const outFile = process.argv[3] ?? 'moves-results.json'
const models = gameModels()
const runSource = source => runBlock(source, [])
const usage = { input: 0, output: 0, calls: 0 }

async function ask(system, user, temperature) {
  const m = models.getModel('cloudflare-workers-ai', cfg.model)
  const t0 = Date.now()
  const reply = await models.completeSimple(m, { systemPrompt: system, messages: [{ role: 'user', content: user, timestamp: Date.now() }] }, { temperature, maxTokens: 500 })
  if (reply.stopReason === 'error') throw new Error(reply.errorMessage)
  usage.input += reply.usage?.input ?? 0; usage.output += reply.usage?.output ?? 0; usage.calls++
  return { text: (reply.content ?? []).filter(c => c.type === 'text').map(c => c.text).join('').trim(), ms: Date.now() - t0 }
}

const jobs = []
const moves = cfg.moves === 'all' ? MOVES : MOVES.filter(m => cfg.moves.includes(m.name))
const wordings = cfg.words ?? [WORDS]
for (const move of moves) for (const type of cfg.types) for (const known of cfg.known) for (const words of wordings) for (let i = 0; i < cfg.samples; i++)
  jobs.push({ move, type, known, words, level: cfg.levels[i % cfg.levels.length], seed: 5000 + jobs.length * 7 })

async function one({ move, type, known, words, level, seed }) {
  const r = rng(seed), bytes = targetBytes(r), data = turnData(bytes, type)
  const know = known ? knowFor(type, { dex: [type] }) : null
  const budget = budgetAt(level)
  const { system, user } = turnPrompt({ self: { name: cfg.self ?? 'CHARMANDER', level }, target: { name: cfg.target ?? 'RATTATA', level, types: [type] }, move, type, know, budget, words })
  try {
    const { text, ms } = await ask(system, user, focusAt(level))
    const { code } = extractCode(text)
    const v = await judge({ move, bytes, data, code, budget, runSource })
    return { move: move.name, type, known, words: `${words.data}/${words.v}`, level, hit: v.hit, reason: v.reason ?? null, got: v.got, want: v.want, error: v.error?.slice(0, 120), ms, text: text.slice(0, 900) }
  } catch (e) { return { move: move.name, type, known, level, hit: false, reason: 'api', error: String(e.message).slice(0, 120) } }
}

const out = new Array(jobs.length); let next = 0, done = 0
await Promise.all(Array.from({ length: cfg.concurrency ?? 12 }, async () => {
  while (next < jobs.length) { const k = next++; out[k] = await one(jobs[k]); if (++done % 200 === 0) console.error(`${done}/${jobs.length}`) }
}))
const rows = out.filter(r => r.reason !== 'api')
const rate = rs => +(rs.filter(r => r.hit).length / Math.max(1, rs.length)).toFixed(3)
const table = {}
const byWords = {}
for (const w of wordings) { const k = `${w.data}/${w.v}`, rs = rows.filter(r => r.words === k); byWords[k] = { first: rate(rs.filter(r => !r.known)), known: rate(rs.filter(r => r.known)), buffer: rs.filter(r => /readUInt|Buffer/.test(r.text ?? '')).length, n: rs.length } }
for (const m of moves) {
  const rs = rows.filter(r => r.move === m.name)
  table[m.name] = { first: rate(rs.filter(r => !r.known)), known: rate(rs.filter(r => r.known)), n: rs.length,
    perType: Object.fromEntries(cfg.types.map(t => [t, [rate(rs.filter(r => r.type === t && !r.known)), rate(rs.filter(r => r.type === t && r.known))]])) }
}
const result = { at: new Date().toISOString(), cfg, usage, api_errors: out.length - rows.length, overall: { first: rate(rows.filter(r => !r.known)), known: rate(rows.filter(r => r.known)) }, byWords, table, rows: out }
writeFileSync(outFile, JSON.stringify(result))
console.error(`overall first ${result.overall.first} known ${result.overall.known} | words ${JSON.stringify(byWords)} | api errors ${result.api_errors} | usage ${JSON.stringify(usage)}`)
