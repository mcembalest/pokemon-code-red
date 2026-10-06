// Score model completions for move contracts in the real game sandbox (pi-codemode).
//   stdin:  JSONL { id, move, seed, level, completion }
//   stdout: JSONL { id, reward, outcome, reason, calls, spent, budget, codeBytes, code }
// Also importable: scoreCompletion(), promptFor().
import { CodemodeSandbox, renderDeclarations } from '@earendil-works/pi-codemode'
import { createInterface } from 'node:readline'
import { CONTRACTS, CRIT_SOURCE_CHARS, makeFoe, moveBudget } from './contracts.mjs'

export const REWARD = { miss: 0, hit: 1, crit: 1.3 }

/** The completion must be exactly one fenced code block (comments allowed, no prose). */
export function extractCode(completion) {
  const text = String(completion ?? '').trim()
  const m = text.match(/^```(?:javascript|js)?[ \t]*\n([\s\S]*?)\n?```$/)
  if (!m) return { code: null, reason: /```/.test(text) ? 'prose outside the code block' : 'no code block' }
  if (/```/.test(m[1])) return { code: null, reason: 'more than one code block' }
  return { code: m[1], reason: null }
}

export function promptFor(move, { species = 'CHARMANDER', level = 5, foe } = {}) {
  const contract = CONTRACTS[move]
  const declarations = renderDeclarations({ tools: contract.tools(makeFoe(1), []) })
  const system = [
    `You are ${species}, a level ${level} Pokémon. You fight by writing code.`,
    'When your trainer picks a move, you write ONE JavaScript code block that performs it, then stop.',
    'Reply with only the code block. No words outside it. Comments inside are fine.',
    'The code is the body of an async function: use await and return; call your move with `await tools.<name>(args)`.',
    `Byte budget for this move: ${moveBudget(level)} bytes of tool traffic. Wasted calls waste bytes.`,
    '',
    declarations,
  ].join('\n')
  const user = `${foe ? `Foe: ${foe.name} Lv${foe.level}. ` : ''}Your trainer says: use ${move}!\n${move}: ${contract.task}`
  return { system, user }
}

async function getSandbox(tools) {
  // A fresh sandbox per episode: tools are bound to that episode's foe + log.
  return new CodemodeSandbox({ tools, timeoutMs: 1500, memoryLimitBytes: 32 << 20 })
}

export async function scoreCompletion({ move, seed, level = 5, completion }) {
  const contract = CONTRACTS[move]
  if (!contract) return { reward: 0, outcome: 'miss', reason: `unknown move ${move}` }
  const { code, reason } = extractCode(completion)
  if (code === null) return { reward: 0, outcome: 'miss', reason, codeBytes: 0 }
  const foe = makeFoe(seed)
  const log = []
  const sb = await getSandbox(contract.tools(foe, log))
  let result
  try { result = await sb.execute(code) } finally { await sb.close() }
  const spent = log.reduce((a, c) => a + c.bytes, 0)
  const budget = moveBudget(level)
  const base = { calls: log.length, spent, budget, codeBytes: Buffer.byteLength(code), code }
  if (!result.ok) return { ...base, reward: 0, outcome: 'miss', reason: `${result.error.kind}: ${result.error.message}`.slice(0, 200) }
  if (spent > budget) return { ...base, reward: 0, outcome: 'miss', reason: 'over byte budget' }
  const verdict = contract.judge(foe, log)
  if (!verdict.ok) return { ...base, reward: 0, outcome: 'miss', reason: 'did not do the move\'s job' }
  const crit = verdict.minimal && code.length <= CRIT_SOURCE_CHARS
  return { ...base, reward: crit ? REWARD.crit : REWARD.hit, outcome: crit ? 'crit' : 'hit', reason: null }
}

// CLI: JSONL in → JSONL out (by id; up to 8 episodes at once, each in its own worker).
if (import.meta.url === `file://${process.argv[1]}`) {
  const rl = createInterface({ input: process.stdin })
  const inFlight = new Set()
  const run = async line => {
    let req
    try { req = JSON.parse(line) } catch { process.stdout.write(JSON.stringify({ error: 'bad json' }) + '\n'); return }
    let out
    try { out = await scoreCompletion(req) } catch (e) { out = { reward: 0, outcome: 'miss', reason: 'evaluator: ' + String(e).slice(0, 200) } }
    process.stdout.write(JSON.stringify({ id: req.id, ...out }) + '\n')
  }
  for await (const line of rl) {
    if (!line.trim()) continue
    const p = run(line).finally(() => inFlight.delete(p))
    inFlight.add(p)
    if (inFlight.size >= 8) await Promise.race(inFlight)
  }
  await Promise.all(inFlight)
}
