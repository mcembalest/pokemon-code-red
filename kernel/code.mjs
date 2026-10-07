// A move = one JavaScript block run in pi-codemode (QuickJS in a worker). Every call the
// block makes to a battle function is metered in bytes: JSON(args) + JSON(result).
import { CodemodeSandbox, renderDeclarations } from '@earendil-works/pi-codemode'

export { renderDeclarations }

/**
 * Pull the code out of a plain-text reply. Lenient on purpose (the code is what's judged):
 * - a fenced block → its body; text outside a fence → no code ("prose")
 * - no fence at all → the whole reply is the code (prose then fails to parse)
 */
export function extractCode(reply) {
  const text = String(reply ?? '').trim()
  const fences = text.match(/```/g)?.length ?? 0
  if (fences === 0) return text ? { code: text, reason: null } : { code: null, reason: 'empty reply' }
  const m = text.match(/^```(?:javascript|js)?[ \t]*\n([\s\S]*?)\n?```$/)
  if (!m) return { code: null, reason: fences > 2 ? 'more than one code block' : 'prose outside the code block' }
  if (m[1].includes('```')) return { code: null, reason: 'more than one code block' }
  return { code: m[1], reason: null }
}

/**
 * Young coders often write `async function scratch() { ... }` and never call it.
 * If the block declares exactly one top-level function and never calls it, call it.
 */
export function normalizeBlock(code) {
  const decls = [...code.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map(m => m[1])
  if (decls.length !== 1) return code
  const name = decls[0]
  const calls = code.match(new RegExp(`(?<![.\\w$])${name}\\s*\\(`, 'g'))?.length ?? 0 // not tools.<name>(
  return calls > 1 ? code : `${code}\nreturn await ${name}()`
}

// Where the sandbox finds QuickJS + its worker. Node: the package defaults. Browser: set by the host
// (see browser/index.mjs) because a bundle has neither file on disk.
let sandboxDefaults = {}
export function configureSandbox(options) { sandboxDefaults = { ...options } }

export const meter = (args, result) => JSON.stringify(args ?? {}).length + JSON.stringify(result ?? null).length

/**
 * Run one block against battle functions. Never throws for script failures.
 * @param {string} code
 * @param {import('@earendil-works/pi-codemode').CodemodeTool[]} tools
 * @returns {Promise<{ ok: boolean, error: string | null, log: {name: string, args: any, bytes: number}[], spent: number, value: any, output: string }>}
 */
export async function runBlock(code, tools, { timeoutMs = 1500, sandboxOptions = {} } = {}) {
  const log = []
  const metered = tools.map(t => ({ ...t, execute: async (args, ctx) => { const out = await t.execute(args, ctx); log.push({ name: t.name, args, bytes: meter(args, out) }); return out } }))
  const sb = new CodemodeSandbox({ tools: metered, timeoutMs, memoryLimitBytes: 32 << 20, ...sandboxDefaults, ...sandboxOptions })
  let r
  try { r = await sb.execute(normalizeBlock(code)) } finally { await sb.close() }
  const spent = log.reduce((a, c) => a + c.bytes, 0)
  const output = (r.output ?? []).map(o => (o.type === 'text' ? o.text : '')).join('\n')
  return { ok: r.ok, error: r.ok ? null : `${r.error.kind}: ${r.error.message}`.slice(0, 200), log, spent, value: r.ok ? r.value : undefined, output }
}
