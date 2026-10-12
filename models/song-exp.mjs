// Song experiment (2026-10-12): can the battle model sing the five emitter moves (rules/song.mjs), and which prompt
// style helps? One call per sample: songPrompt → the model → judgeSong. No game, no memory, no foe data.
//   CLOUDFLARE_API_KEY=… CLOUDFLARE_ACCOUNT_ID=… node song-exp.mjs song-exp.json song-results.json
// song-exp.json: { models, styles, levels, samples, concurrency, moves? }. Hit rates per style × move × level go to
// stderr (the workflow's notices) and everything to the results file.
import { readFileSync, writeFileSync } from 'node:fs'
import { gameModels } from '../kernel/index.mjs'
import { writeCode } from '../kernel/write.mjs'
import { EMIT, GROWTH, budgetAt, byName, focusAt, judgeSong, rng, songPrompt, tokenCapFor } from '../rules/index.mjs'

const cfg = JSON.parse(readFileSync(process.argv[2] ?? 'song-exp.json', 'utf8'))
const outFile = process.argv[3] ?? 'song-results.json'
const log = (...a) => console.error(...a)
const models = gameModels()
const FOES = [['RATTATA', 3], ['PIDGEY', 4], ['GEODUDE', 10], ['ONIX', 14], ['STARYU', 18]]
const SELVES = [['BULBASAUR', 'SQUIRTLE', 'CHARMANDER', 'PIKACHU', 'GEODUDE']]

async function sample({ model, style, move, level, seed }) {
  const r = rng(seed)
  const spec = EMIT[move.name]
  let key = spec.key(r)
  if (key === spec.example.key) key = spec.key(r)
  const self = { name: SELVES[0][seed % 5], level }, foe = FOES[seed % FOES.length]
  const budget = budgetAt(level)
  const prompt = songPrompt({ self, target: { name: foe[0], level: foe[1] }, move, key, budget, style })
  const t0 = Date.now()
  let text = '', error = null
  try {
    const res = await writeCode({ models, model: { provider: 'cloudflare-workers-ai', modelId: model }, system: prompt.system, user: prompt.user, temperature: focusAt(level, GROWTH), maxTokens: tokenCapFor(budget) })
    text = res.text
  } catch (e) { error = String(e?.message ?? e) }
  const v = error ? { hit: false, reason: 'network' } : judgeSong({ move, text, key, budget })
  return { model, style, move: move.name, level, seed, key, hit: v.hit, reason: v.reason ?? null, error: v.error ?? error ?? null, got: v.got ?? null, text: text.slice(0, 400), ms: Date.now() - t0 }
}

async function main() {
  const moves = (cfg.moves ?? Object.keys(EMIT)).map(n => byName[n])
  const jobs = []
  for (const model of cfg.models) for (const style of cfg.styles) for (const move of moves) for (const level of cfg.levels) for (let s = 0; s < cfg.samples; s++) jobs.push({ model, style, move, level, seed: s + 100 * level })
  const results = []
  let next = 0
  const worker = async () => { while (next < jobs.length) { const j = jobs[next++]; results.push(await sample(j)); if (results.length % 25 === 0) log(`${results.length}/${jobs.length}`) } }
  await Promise.all(Array.from({ length: cfg.concurrency ?? 4 }, worker))
  const rate = rs => rs.length ? `${Math.round(100 * rs.filter(x => x.hit).length / rs.length)}% of ${rs.length}` : '—'
  const why = rs => { const c = {}; for (const x of rs.filter(x => !x.hit)) c[x.reason] = (c[x.reason] ?? 0) + 1; return Object.entries(c).map(([k, v]) => `${k} ${v}`).join(', ') }
  const summary = {}
  for (const model of cfg.models) for (const style of cfg.styles) {
    const rs = results.filter(x => x.model === model && x.style === style)
    log(`${model.split('/').pop()} ${style}: ${rate(rs)} (${why(rs)})`)
    for (const move of moves) {
      const ms = rs.filter(x => x.move === move.name)
      log(`  ${move.name}: ${rate(ms)} · ` + cfg.levels.map(l => `L${l} ${rate(ms.filter(x => x.level === l))}`).join(' · ') + (why(ms) ? ` (${why(ms)})` : ''))
      summary[`${model}|${style}|${move.name}`] = { n: ms.length, hit: ms.filter(x => x.hit).length }
    }
  }
  writeFileSync(outFile, JSON.stringify({ cfg, summary, results }, null, 1))
}
main().catch(e => { log(e); process.exit(1) })
