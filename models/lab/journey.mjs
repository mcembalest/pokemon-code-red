// Journey sim: one CHARMANDER plays Pallet → Misty, turn by turn, on the shared rules (rules/).
//   move = a function it writes · foe type = data format · byte budget = max code size · focus = temperature
//   it learns how to read each type from verified hits; memory has slots; the party Pokédex gives readers for
//   types seen (policy.dexSeen) or caught; badges teach (policy.badges: Boulder = ROCK+GROUND readers, Cascade = +50 bytes).
//   CLOUDFLARE_API_KEY=… CLOUDFLARE_ACCOUNT_ID=… node lab/journey.mjs lab/journey.json out.json
import { readFileSync, writeFileSync } from 'node:fs'
import { extractCode, gameModels, runBlock } from '../../kernel/index.mjs'
import { GROWTH, budgetAt, byName, focusAt, judge, knowFor, learnFromHit, partyDex, rng, slotsAt, targetBytes, turnData, turnPrompt, turnType } from '../../rules/index.mjs'

const cfg = JSON.parse(readFileSync(process.argv[2] ?? 'lab/journey.json', 'utf8'))
const outFile = process.argv[3] ?? 'journey-results.json'
const models = gameModels()
const log = (...a) => console.error(...a)
const usage = { input: 0, output: 0, calls: 0 }
const runSource = source => runBlock(source, [])

// Route order (FireRed, from notes/inventory-to-misty.md), compressed. [segment, foe, types, level, turns, catch?]
const ROUTE = [
  ['Oak\'s lab', 'SQUIRTLE', ['WATER'], 5, 4],
  ['Route 1', 'PIDGEY', ['NORMAL', 'FLYING'], 3, 3, true], ['Route 1', 'RATTATA', ['NORMAL'], 3, 3, true], ['Route 1', 'PIDGEY', ['NORMAL', 'FLYING'], 4, 3], ['Route 1', 'RATTATA', ['NORMAL'], 4, 3],
  ['Route 22', 'MANKEY', ['FIGHTING'], 4, 3, true], ['Route 22', 'SPEAROW', ['NORMAL', 'FLYING'], 4, 3], ['Route 22', 'RATTATA', ['NORMAL'], 5, 3],
  ['Viridian Forest', 'CATERPIE', ['BUG'], 4, 3, true], ['Viridian Forest', 'WEEDLE', ['BUG', 'POISON'], 4, 3, true], ['Viridian Forest', 'PIKACHU', ['ELECTRIC'], 5, 4, true],
  ['Viridian Forest', 'METAPOD', ['BUG'], 6, 4], ['Viridian Forest', 'KAKUNA', ['BUG', 'POISON'], 6, 3], ['Viridian Forest', 'WEEDLE', ['BUG', 'POISON'], 7, 3],
  ['Pewter Gym', 'GEODUDE', ['ROCK', 'GROUND'], 10, 4], ['Brock', 'GEODUDE', ['ROCK', 'GROUND'], 12, 4], ['Brock', 'ONIX', ['ROCK', 'GROUND'], 14, 5],
  ['Route 3', 'SPEAROW', ['NORMAL', 'FLYING'], 8, 3], ['Route 3', 'JIGGLYPUFF', ['NORMAL'], 6, 3, true], ['Route 3', 'NIDORAN', ['POISON'], 7, 3, true],
  ['Mt. Moon', 'ZUBAT', ['POISON', 'FLYING'], 9, 3, true], ['Mt. Moon', 'GEODUDE', ['ROCK', 'GROUND'], 9, 3, true], ['Mt. Moon', 'PARAS', ['BUG', 'GRASS'], 10, 3, true], ['Mt. Moon', 'CLEFAIRY', ['NORMAL'], 10, 3],
  ['Mt. Moon', 'MAGNEMITE', ['ELECTRIC', 'STEEL'], 11, 3], ['Mt. Moon', 'GRIMER', ['POISON'], 12, 3],
  ['Route 4', 'EKANS', ['POISON'], 11, 3, true], ['Route 4', 'SANDSHREW', ['GROUND'], 12, 3, true],
  ['Cerulean', 'ODDISH', ['GRASS', 'POISON'], 13, 3, true], ['Cerulean (rival)', 'ABRA', ['PSYCHIC'], 16, 3], ['Cerulean (rival)', 'SQUIRTLE', ['WATER'], 18, 4],
  ['Misty', 'STARYU', ['WATER'], 18, 5], ['Misty', 'STARMIE', ['WATER', 'PSYCHIC'], 21, 6],
]
// CHARMANDER's real learnset (Gen 3): Scratch, Growl, Ember 7, Metal Claw 13, Smokescreen 19
const MOVES_BY_LEVEL = [[1, 'SLICE'], [1, 'ERROR'], [7, 'BURNDISC'], [13, 'HASH'], [19, 'BLUR']]

async function ask(model, system, user, temperature) {
  const m = models.getModel('cloudflare-workers-ai', model)
  const reply = await models.completeSimple(m, { systemPrompt: system, messages: [{ role: 'user', content: user, timestamp: Date.now() }] }, { temperature, maxTokens: 500 })
  if (reply.stopReason === 'error') throw new Error(reply.errorMessage)
  usage.input += reply.usage?.input ?? 0; usage.output += reply.usage?.output ?? 0; usage.calls++
  return (reply.content ?? []).filter(c => c.type === 'text').map(c => c.text).join('').trim()
}

async function journey(seed, policy) {
  const r = rng(seed)
  const growth = { ...GROWTH, ...policy }
  let level = 5, xp = 0
  let readers = {}           // type → reader line (most recent last); limited by slots
  const seen = new Set()     // types in the party Pokédex
  const badges = []
  const turns = []
  for (const [segment, foeName, types, foeLevel, nTurns, caught] of ROUTE) {
    for (let k = 0; k < nTurns; k++) {
      const known = MOVES_BY_LEVEL.filter(([l]) => l <= level).map(([, n]) => byName[n]).filter(m => m.name !== 'ERROR' || r() < 0.25)
      const move = known[Math.floor(r() * known.length)]
      const t = turnType(r, types)
      const bytes = targetBytes(r)
      const data = turnData(bytes, t)
      const stage = level >= 16 ? 1 : 0
      const dex = policy.dex ? partyDex({ seen: [...seen], badges }) : []
      const know = knowFor(t, { dex, readers: policy.learn ? readers : {} })
      const budget = budgetAt(level, { stage, badges }, growth)
      const { system, user } = turnPrompt({ self: { name: 'CHARMANDER', level }, target: { name: foeName, level: foeLevel, types }, move, type: t, know, budget })
      let outcome, code
      try {
        const text = await ask(cfg.model, system, user, focusAt(level, growth))
        const got = extractCode(text)
        code = got.code
        outcome = got.code === null ? { hit: false, reason: 'no code' } : await judge({ move, bytes, data, code, budget, runSource })
      } catch (e) { outcome = { hit: false, reason: 'api: ' + String(e.message).slice(0, 80) } }
      if (policy.learn && outcome.hit) readers = await learnFromHit({ readers, type: t, code, data, bytes, slots: slotsAt(level, { stage }, growth), dex, runSource })
      turns.push({ segment, foe: foeName, type: t, level, move: move.name, temperature: +focusAt(level, growth).toFixed(2), budget, hit: outcome.hit, reason: outcome.reason ?? null, dex: know?.from === 'dex', remembered: know?.from === 'memory' })
      xp += foeLevel; while (xp >= level * 6 && level < 21) { xp -= level * 6; level++ }
    }
    if ((caught || policy.dexSeen) && policy.dex) for (const ty of types) seen.add(ty) // dexSeen: seeing a species is enough (FireRed's 'seen')
    if (policy.badges && foeName === 'ONIX') badges.push('BOULDER')
    if (policy.badges && foeName === 'STARMIE') badges.push('CASCADE')
  }
  return { turns, finalLevel: level, readers, badges }
}

const results = { at: new Date().toISOString(), cfg, policies: {} }
await Promise.all(Object.entries(cfg.policies).map(async ([name, policy]) => {
  policy = { ...cfg.defaults, ...policy }
  const runs = await Promise.all(Array.from({ length: cfg.journeys }, (_, i) => journey(4242 + i * 7, policy)))
  const all = runs.flatMap(j => j.turns)
  const seg = {}
  for (const tr of all) { const s = (seg[tr.segment] ??= { n: 0, hit: 0 }); s.n++; s.hit += tr.hit ? 1 : 0 }
  const reasons = {}; for (const tr of all) if (!tr.hit) reasons[tr.reason] = (reasons[tr.reason] ?? 0) + 1
  results.policies[name] = {
    policy, hit: +(all.filter(t => t.hit).length / all.length).toFixed(3), reasons,
    segments: Object.fromEntries(Object.entries(seg).map(([k, v]) => [k, +(v.hit / v.n).toFixed(2)])),
    byLevel: Object.fromEntries([...new Set(all.map(t => t.level))].map(L => [L, +(all.filter(t => t.level === L && t.hit).length / all.filter(t => t.level === L).length).toFixed(2)])),
    readers: runs.map(j => j.readers), finalLevels: runs.map(j => j.finalLevel), sample: runs[0].turns,
  }
  writeFileSync(outFile, JSON.stringify(results, null, 1))
  log(`${name}: hit ${results.policies[name].hit} | ${Object.entries(results.policies[name].segments).map(([k, v]) => `${k} ${v}`).join(' · ')} | ${JSON.stringify(reasons)}`)
}))
results.usage = usage
results.done = true
writeFileSync(outFile, JSON.stringify(results, null, 1))
log(`usage: ${JSON.stringify(usage)}`)
