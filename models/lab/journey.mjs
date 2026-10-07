// Journey sim: one CHARMANDER plays Pallet → Misty, turn by turn, on the draft rules.
//   move = a function it writes · foe type = data format · byte budget = max code size · focus = temperature
//   it learns how to read each type when a hit lands (and forgets a reader that misses); memory has slots;
//   Pokédex readers unlock when a species is caught (policy).
//   CLOUDFLARE_API_KEY=… CLOUDFLARE_ACCOUNT_ID=… node lab/journey.mjs lab/journey.json out.json
import { readFileSync, writeFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import { extractCode, gameModels, runBlock } from '../../kernel/index.mjs'
import { rng } from '../contracts.mjs'
import { byName } from '../battle/moves.mjs'
import { cleanBytes } from '../battle/types.mjs'
import { EXAMPLE_BYTES, FORMATS, HINTS, example, show } from './formats.mjs'
import { definedName } from './variants.mjs'

const cfg = JSON.parse(readFileSync(process.argv[2] ?? 'lab/journey.json', 'utf8'))
const outFile = process.argv[3] ?? 'journey-results.json'
const models = gameModels()
const log = (...a) => console.error(...a)
const usage = { input: 0, output: 0, calls: 0 }

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
const MOVES_BY_LEVEL = [[1, 'SLICE'], [1, 'ERRORMSG'], [7, 'BURNDISC'], [13, 'HASH'], [19, 'OBFUSCATE']]

const focusAt = (L, p) => Math.max(p.minTemp, p.startTemp - p.tempPerLevel * (L - 5))
const budgetAt = (L, p) => p.budgetBase + p.budgetPerLevel * L + (L >= 16 ? p.evolutionBudget : 0)
const slotsAt = (L, p) => p.slotsBase + Math.floor((L - 5) / p.levelsPerSlot) + (L >= 16 ? p.evolutionSlots : 0)

async function ask(model, system, user, temperature) {
  const m = models.getModel('cloudflare-workers-ai', model)
  const reply = await models.completeSimple(m, { systemPrompt: system, messages: [{ role: 'user', content: user, timestamp: Date.now() }] }, { temperature, maxTokens: 500 })
  if (reply.stopReason === 'error') throw new Error(reply.errorMessage)
  usage.input += reply.usage?.input ?? 0; usage.output += reply.usage?.output ?? 0; usage.calls++
  return (reply.content ?? []).filter(c => c.type === 'text').map(c => c.text).join('').trim()
}

async function judge(move, code, data, clean) {
  const name = definedName(code, move.fn)
  const run = await runBlock(`return (function (data) {\n${code}\n;return typeof ${name} === 'function' ? ${name}(data) : undefined\n})(${JSON.stringify(data)})`, [])
  if (!run.ok) return { hit: false, reason: run.error.split(':')[0] }
  return isDeepStrictEqual(run.value, move.ref(clean, {})) ? { hit: true } : { hit: false, reason: 'wrong answer' }
}

async function readsRight(line, data, clean) {
  const run = await runBlock(`const data = ${JSON.stringify(data)}\n${line}\nreturn bytes`, [])
  return run.ok && isDeepStrictEqual(run.value, clean)
}

async function journey(seed, policy) {
  const r = rng(seed)
  let level = 5, xp = 0
  const readers = new Map() // type → reader line (most recent last); limited by slots
  const dex = new Set()     // types with a Pokédex reader
  const turns = []
  for (const [segment, foeName, types, foeLevel, nTurns, caught] of ROUTE) {
    for (let k = 0; k < nTurns; k++) {
      const known = MOVES_BY_LEVEL.filter(([l]) => l <= level).map(([, n]) => byName[n]).filter(m => m.name !== 'ERRORMSG' || r() < 0.25)
      const move = known[Math.floor(r() * known.length)]
      const both = policy.gymBoth && types.length > 1 && ['Brock', 'Misty'].includes(segment) && (!policy.aceOnly || ['ONIX', 'STARMIE'].includes(foeName)) // gym leaders switch formats mid-battle
      const t = types[Math.floor(r() * types.length)] // a dual-type foe sends either format
      const turnTypes = both ? types : [t]
      const clean = cleanBytes(r, [t])
      const data = FORMATS[t].encode(clean)
      const ex = [42, 13, 140, 77]
      const reader = policy.learn ? readers.get(t) : null
      const memory = ''
      const budget = budgetAt(level, policy) + (both ? (policy.gymBudgetBonus ?? 0) : 0)
      const system = [`You are CHARMANDER, a level ${level} Pokémon. You fight by writing JavaScript.`, 'When your trainer calls a move, you write the code for it, then stop.',
        'Reply with only one JavaScript code block. No words outside it. Comments inside are fine.'].join('\n')
      const know = ty => policy.dex && dex.has(ty) ? `Pokédex: ${ty} data reads like this: ${HINTS[ty]}` : (policy.learn && readers.get(ty)) ? `You remember how you read ${ty} data: ${readers.get(ty)}` : null
      const formatLines = both
        ? [`- data = the foe's bytes. ${foeName} switches formats, so your function must read both:`, ...types.map(ty => `  - ${ty} format: ${FORMATS[ty].note}. Example: ${show(example(ty))} is [${EXAMPLE_BYTES.join(', ')}].${know(ty) ? ' ' + know(ty) : ''}`)]
        : [`- data = the foe's bytes, this turn in ${t} format: ${FORMATS[t].note}. Example: ${show(example(t))} is [${EXAMPLE_BYTES.join(', ')}].`,
          know(t) ? `- ${know(t)}` : '- First line of the function: const bytes = <read data into a list of numbers>']
      const user = [`Foe: ${foeName} Lv${foeLevel} (${types.join('/')}). Your trainer says: use ${move.name}!`, `Write the function: function ${move.fn}(data)`, ...formatLines,
        `- ${move.fn} returns ${move.spec}${move.shape === 'no key' ? '' : ` (${move.shape})`}. On the numbers ${JSON.stringify(ex)} it returns ${JSON.stringify(move.ref(ex, {}))}.`,
        `- Byte budget: your whole code block must be at most ${budget} characters, comments included.`].join('\n')
      const temperature = focusAt(level, policy)
      let outcome
      try {
        const text = await ask(cfg.model, system, user, temperature)
        const { code, reason } = extractCode(text)
        if (code === null) outcome = { hit: false, reason }
        else if (code.length > budget) outcome = { hit: false, reason: 'over byte budget', code }
        else {
          outcome = { ...(await judge(move, code, data, clean)), code }
          for (const ty of turnTypes) if (outcome.hit && ty !== t) outcome = { ...(await judge(move, code, FORMATS[ty].encode(clean), clean)), code }
        }
      } catch (e) { outcome = { hit: false, reason: 'api: ' + String(e.message).slice(0, 80) } }
      // learning: a hit teaches (or refreshes) how it read this type; a miss with a remembered reader forgets it
      if (policy.learn) {
        const line = outcome.code?.match(/const\s+bytes\s*=\s*[^\n;]+/)?.[0]
        // keep a reader only if it really reads this type (checked on this turn's data): no lucky habits
        if (outcome.hit && line && !(policy.dex && dex.has(t)) && await readsRight(line, data, clean)) { readers.delete(t); readers.set(t, line) }
        while (readers.size > slotsAt(level, policy)) readers.delete(readers.keys().next().value)
      }
      turns.push({ code: both ? outcome.code?.slice(0, 600) : undefined, segment, foe: foeName, type: t, both, level, move: move.name, temperature: +temperature.toFixed(2), budget, hit: outcome.hit, reason: outcome.reason ?? null, dex: dex.has(t), remembered: !!reader })
      xp += foeLevel; while (xp >= level * 6 && level < 21) { xp -= level * 6; level++ }
    }
    if ((caught || policy.dexSeen) && policy.dex) for (const ty of types) dex.add(ty) // dexSeen: seeing a species is enough (FireRed's 'seen')
  }
  return { turns, finalLevel: level, readers: Object.fromEntries(readers) }
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
