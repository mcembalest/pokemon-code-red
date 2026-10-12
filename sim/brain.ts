// The page's code-move brain (player/src/agents/code-battle.ts: prompts, budgets, readers, judging, payloads) run in
// Node for the simulator, against the real models. One JSON line in, one JSON line out:
//   {"op":"turn","req":<MoveRequest>,"badges":["BOULDER"],"called":"ERROR"|null}
//     → {"verdict","reason","payload":{"kind","bytes","palette"}|null,"record":<TurnRecord>,"usage":{input,output}}
//   {"op":"battle_over"} → {"ok":true}
// Models: straight to Workers AI (CLOUDFLARE_API_KEY, CLOUDFLARE_ACCOUNT_ID), or through the live game API when
// BRAIN_API (+ BRAIN_TOKEN, a session token) is set — exactly the route a player's browser takes.
//   node --experimental-strip-types sim/brain.ts build/code-red.gba build/rom/rom.json      (BRAIN_MOCK=1: stand-in model; SONG=1: sung moves)
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { CodeBattle, localCodeMemory, mockWriter, type CodeWriter, type Panel, type TurnRecord } from '../player/src/agents/code-battle.ts'
import { BattleReader } from '../player/src/agents/battle.ts'
import type { MoveRequest } from '../player/src/bridge/code-move.ts'
import { runBlock } from '../kernel/code.mjs'
import { gameModels, gameApiProvider, GAME_PROVIDER } from '../kernel/index.mjs'
import { BATTLE_MODEL, PAYLOAD_MODEL, writeCode } from '../kernel/write.mjs'
import { SONG } from '../rules/index.mjs'

// SONG=1: the five emitter moves are sung (rules/song.mjs prototype), as the page does with ?song=1.
if (process.env.SONG === '1') SONG.enabled = true

const [romPath, romJson] = process.argv.slice(2)
const rom = new Uint8Array(readFileSync(romPath))
const symbols = JSON.parse(readFileSync(romJson, 'utf8')).symbols
const names = new BattleReader({ u8: () => 0, u16: () => 0, u32: () => 0 } as never, rom, symbols)

const api = process.env.BRAIN_API
let models: unknown, provider: string
if (api) {
  models = gameModels(gameApiProvider({ baseUrl: api.replace(/\/$/, '') + '/v1/ai', token: () => process.env.BRAIN_TOKEN ?? '', modelIds: [BATTLE_MODEL, PAYLOAD_MODEL] }))
  provider = GAME_PROVIDER
} else { models = gameModels(); provider = 'cloudflare-workers-ai' }

const usage = { input: 0, output: 0 }
const real: CodeWriter = {
  async write(prompt, onText) {
    const modelId = prompt.meta.move?.payload || (prompt.meta.sung && SONG.coder) ? PAYLOAD_MODEL : BATTLE_MODEL // sung moves: the 3B sings 25%, the coder 100% (models/song-exp, 2026-10-12)
    const r = await writeCode({ models, model: { provider, modelId }, system: prompt.system, user: prompt.user, temperature: prompt.temperature, maxTokens: prompt.maxTokens, onText })
    usage.input += r.usage?.input ?? 0; usage.output += r.usage?.output ?? 0
    return r.text
  },
}
// BRAIN_MOCK=1: the page's stand-in model (no network), for testing the plumbing.
const writer: CodeWriter = process.env.BRAIN_MOCK ? mockWriter({ delay: async () => {} }) : real
const sandbox = { run: (source: string) => runBlock(source, []) as never }
const panel: Panel = { begin() {}, text() {}, async end() {} }
const minds = localCodeMemory(null)

// One request at a time, like the ROM.
let current: { req: MoveRequest; done: (v: { verdict: string; reason?: string }) => void } | null = null
const mailbox = {
  enable() {},
  snapshot: () => (current ? current.req : null),
  reply(req: MoveRequest, verdict: string, reason?: string) { if (current && current.req.id === req.id) { const c = current; current = null; c.done({ verdict, reason }) } return true },
}
let payload: { kind: string; bytes: number[]; palette?: unknown } | null = null
let record: TurnRecord | null = null
let badges: string[] = [], called: string | null = null
let remembered: unknown[] = []
const battle = new CodeBattle(mailbox as never, names, writer, sandbox, panel, minds, {
  badges: () => badges,
  payload: { deliver(kind: string, bytes: number[], palette?: unknown) { payload = { kind, bytes, palette }; return true } } as never,
  calledMove: () => called,
  onTurn: r => { record = r },
  onRemember: r => { remembered.push({ attacker: r.attacker, level: r.level, cap: r.cap, ok: r.ok, reason: r.reason, ms: r.ms, before: r.before, carried: r.carried, after: r.after }) },
})

const out = (o: unknown) => process.stdout.write(JSON.stringify(o) + '\n')
for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue
  const msg = JSON.parse(line)
  if (msg.op === 'battle_over') {
    const before = { ...usage }
    remembered = []
    await battle.battleOver() // consolidation: one model call per Pokémon that fought
    out({ ok: true, remembered, usage: { input: usage.input - before.input, output: usage.output - before.output } }); continue
  }
  badges = msg.badges ?? []; called = msg.called ?? null; payload = null; record = null
  const before = { ...usage }
  const result = await new Promise<{ verdict: string; reason?: string }>(done => { current = { req: msg.req, done }; void battle.poll() })
  // poll() resolves the reply; onTurn fires just after it
  await new Promise(r => setTimeout(r, 0))
  out({ ...result, payload, record, usage: { input: usage.input - before.input, output: usage.output - before.output } })
}
