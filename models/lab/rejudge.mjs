// Re-judge a moves lab result with today's rules, offline: same bytes (seeded by job index), same replies, no API calls.
//   node lab/rejudge.mjs lab-results.json [MOVE…]  → hit rates and the commonest miss reasons
import { readFileSync } from 'node:fs'
import { extractCode, runBlock } from '../../kernel/index.mjs'
import { byName, budgetAt, judge, rng, targetBytes, turnData } from '../../rules/index.mjs'

const d = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const only = process.argv.slice(3)
const by = {}
for (const [k, r] of d.rows.entries()) {
  if (!r.text || (only.length && !only.includes(r.move))) continue
  const bytes = targetBytes(rng(5000 + k * 7)), move = byName[r.move]
  const { code } = extractCode(r.text)
  const v = await judge({ move, bytes, data: turnData(bytes, r.type), code, budget: budgetAt(r.level), runSource: s => runBlock(s, []) })
  const m = (by[r.move] ??= { n: 0, hit: 0, why: {} })
  m.n++; if (v.hit) m.hit++; else { const w = v.want ?? v.reason; m.why[w] = (m.why[w] ?? 0) + 1 }
}
for (const [k, m] of Object.entries(by)) console.log(k.padEnd(9), `${m.hit}/${m.n}`, Object.entries(m.why).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([w, n]) => `${n}× ${w}`).join(' | '))
