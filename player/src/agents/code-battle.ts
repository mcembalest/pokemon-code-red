// Code moves, host side: when a Pokémon gets to use a move (ROM: patches/006-code-moves.patch), it writes
// the move's function (model through the backend), the code runs on the target's bytes in the sandbox, and
// the game hears hit / miss / vanilla. Both sides. The rules are shared with the simulator (rules/).
//   turn pace (owner, 2026-10-08): your code → your move → foe's code → foe's move (the ROM asks in that order)
//   foes: focus + budget from level; knowledge by tier (owner, 2026-10-08): wild none, trainers half the formats, leaders and the rival all
//   memory: each Pokémon keeps its own readers; the Pokédex (types seen in past battles + badge readers) is shared
//   model or network failure: retry once, then plain FireRed (accuracy roll)
import {
  BADGES, FORMATS, GROWTH, HINTS, budgetAt, byFireRed, byName, codeBudget, combinedNotch, contextCost, extractCode, focusAt, foeDex, formatOf, judge, knowFor, learnFromHit, missText, notchOf, partyDex,
  rng, stageOf, targetBytes, tierOf, tokenCapFor, turnData, turnPrompt, turnType,
  type Know, type Move, type Readers, type RunResult, type TypeName, type Verdict as Judged,
} from '../../../rules/index.mjs'
import { BATTLE_TYPE_FIRST_BATTLE, BATTLE_TYPE_TRAINER, type CodeMoveMailbox, type MissReason, type MoveRequest, type Verdict } from '../bridge/code-move.ts'
import type { PayloadMailbox, PayloadKind } from '../bridge/payload.ts'

export interface Names { moveName(id: number): string; speciesName(id: number): string; typeName(id: number): string }
export interface Prompt {
  system: string; user: string; temperature: number
  /** The model's token cap, derived from the byte budget (a safety stop, not a rule). */
  maxTokens: number
  /** For mock writers (tests, offline play); a real model only sees system + user. */
  meta: { move: Move; type: TypeName; tutorial: boolean }
}
/** Streams one reply; throws on a model or network failure. */
export interface CodeWriter { write(prompt: Prompt, onText: (delta: string) => void): Promise<string> }
export interface Sandbox { run(source: string, inputJSON: string): Promise<RunResult> }

/** What the code panel shows for one turn. */
export interface TurnInfo {
  side: 0 | 1; attacker: string; target: string; move: string; spec: string; fn: string
  type: TypeName; tutorial: boolean; know: Know['from'] | null; budget: number; wild: boolean
  /** Bytes the memory it carries this turn takes out of the budget (the reader + hot memory). */
  memoryCost: number
  /** -2..2: how shaken (negative) or steadied the writer's code brain is this turn (status moves hit the code). */
  notch: number
  /** The move makes bytes the game will play or draw instead of answering. */
  makes?: PayloadKind
  /** Your Pokémon doubts your pick: how shaken (−1/−2) and the move its instinct wanted. */
  doubt?: { notch: number; wanted: string | null }
}
export interface TurnResult { verdict: Verdict; reason?: MissReason; text: string; detail?: string }
export interface Panel {
  begin(info: TurnInfo): void
  text(side: 0 | 1, delta: string): void
  /** Resolves when the code has been shown (readable pace) and the verdict is up. */
  end(side: 0 | 1, result: TurnResult): Promise<void>
}

/** Learned readers per Pokémon, and what has been seen; kept by the page (local storage for now). */
export interface CodeMemory {
  readers(personality: number): Readers
  setReaders(personality: number, readers: Readers): void
  /** Hot memory: the note the trainer typed for this Pokémon (goes into every prompt, costs bytes). */
  hot(personality: number): string
  setHot(personality: number, text: string): void
  /** Types the party has battled (Pokédex readers). */
  seen(): string[]
  addSeen(types: string[]): void
  /** Code history: the last turns this Pokémon wrote (PokÉEG System 2 view). */
  recent?(personality: number): CodeTurn[]
  remember?(personality: number, turn: CodeTurn): void
  /** The whole mind store, for the cloud save bundle (and back). */
  export?(): unknown
  import?(state: unknown): void
}

export interface CodeTurn {
  at: number; move: string; type: TypeName; target: string; verdict: Verdict; reason?: string; notch: number; budget: number; code: string
}
export const HISTORY = 20

export interface TurnRecord {
  side: 0 | 1; attacker: string; target: string; move: string; type: TypeName; tutorial: boolean; know: string | null; notch?: number
  verdict: Verdict; reason?: string; ms: number; tries: number; code?: string
  /** The move made bytes (a sound, a picture) and the game got them. */
  payload?: PayloadKind
  doubt?: number
}

export interface CodeBattleOptions {
  /** Badge names the player holds (BADGES keys), e.g. from the save's badge flags. */
  badges?: () => string[]
  onTurn?: (record: TurnRecord) => void
  /** Where a move's bytes (a sound, a picture) go so the game can play or draw them on the hit. */
  payload?: PayloadMailbox
  /** Doubt (rules/doubt.mjs): your Pokémon's instinct scores the move you called; the page computes it from the battle. */
  doubt?: (req: MoveRequest) => { notch: number; wanted: string | null }
}

export class CodeBattle {
  private pending = false
  private seenNow = new Set<string>()
  private readonly mailbox: CodeMoveMailbox
  private readonly names: Names
  private readonly writer: CodeWriter
  private readonly sandbox: Sandbox
  private readonly panel: Panel
  private readonly memory: CodeMemory
  private readonly options: CodeBattleOptions

  constructor(mailbox: CodeMoveMailbox, names: Names, writer: CodeWriter, sandbox: Sandbox, panel: Panel, memory: CodeMemory, options: CodeBattleOptions = {}) {
    this.mailbox = mailbox; this.names = names; this.writer = writer; this.sandbox = sandbox; this.panel = panel; this.memory = memory; this.options = options
  }

  /** Call often (every frame or so). */
  async poll(): Promise<void> {
    this.mailbox.enable(true)
    if (this.pending) return
    const request = this.mailbox.snapshot()
    if (!request) return
    this.pending = true
    try { await this.turn(request) } catch { this.mailbox.reply(request, 'vanilla') } finally { this.pending = false }
  }

  /** The battle ended: what was seen in it counts from the next battle on. */
  battleOver(): void {
    if (this.seenNow.size) this.memory.addSeen([...this.seenNow])
    this.seenNow.clear()
  }

  private async turn(req: MoveRequest): Promise<void> {
    const started = Date.now()
    const romMove = this.names.moveName(req.move)
    const move = byName[romMove] ?? byFireRed(romMove) // the ROM shows Code Red names (patches/007); older builds FireRed's
    if (!move) { this.mailbox.reply(req, 'vanilla'); return } // no code for this move yet: plain FireRed
    const side = req.attackerSide
    const attacker = this.names.speciesName(req.attackerSpecies), target = this.names.speciesName(req.targetSpecies)
    const types = [...new Set(req.targetTypes.map(t => formatOf(this.names.typeName(t))))] as TypeName[]
    const wild = !(req.battleTypeFlags & BATTLE_TYPE_TRAINER), tutorial = (req.battleTypeFlags & BATTLE_TYPE_FIRST_BATTLE) !== 0
    if (side === 0) types.forEach(t => this.seenNow.add(t))

    const r = rng((req.id * 2654435761) ^ req.attackerPersonality ^ req.epoch)
    const type = turnType(r, types), bytes = targetBytes(r), data = turnData(bytes, type, tutorial)
    const badges = side === 0 ? (this.options.badges?.() ?? []).filter(b => b in BADGES) : []
    const stage = stageOf(attacker)
    const readers = side === 0 ? this.memory.readers(req.attackerPersonality) : {}
    const dex = side === 0 ? partyDex({ seen: this.memory.seen(), badges }) : foeDex(tierOf(req.trainerClass, wild), req.attackerPersonality, Object.keys(FORMATS))
    const know = tutorial ? null : knowFor(type, { dex, readers })
    const hot = side === 0 ? this.memory.hot(req.attackerPersonality).trim() : ''
    const doubt = side === 0 && !tutorial ? this.options.doubt?.(req) ?? null : null
    const notch = combinedNotch(notchOf(req.attackerStages), doubt?.notch ?? 0)
    const budget = budgetAt(req.attackerLevel, { stage, badges, notch })
    const memoryCost = contextCost({ know, hot })
    const prompt = turnPrompt({ self: { name: attacker, level: req.attackerLevel, wild: side === 1 && wild }, target: { name: target, level: req.targetLevel, types }, move, type, know, budget, tutorial, hot })

    this.panel.begin({ side, attacker, target, move: move.name, spec: move.spec, fn: move.fn, type, tutorial, know: know?.from ?? null, budget, wild, notch, memoryCost, ...(move.payload ? { makes: move.payload.kind } : {}), ...(doubt && doubt.notch ? { doubt } : {}) })
    let text: string | null = null, tries = 0
    while (text === null && tries < 2) {
      tries++
      try { text = await this.writer.write({ ...prompt, temperature: focusAt(req.attackerLevel, GROWTH, notch), maxTokens: tokenCapFor(budget), meta: { move, type, tutorial } }, delta => this.panel.text(side, delta)) }
      catch { if (tries < 2) this.panel.text(side, '\n// connection hiccup, writing again…\n') }
    }
    if (text === null) {
      await this.panel.end(side, { verdict: 'vanilla', text: 'Connection lost: this move plays like plain FireRed.' })
      this.mailbox.reply(req, 'vanilla')
      this.options.onTurn?.({ side, attacker, target, move: move.name, type, tutorial, know: know?.from ?? null, verdict: 'vanilla', reason: 'network', ms: Date.now() - started, tries })
      return
    }
    const { code } = extractCode(text)
    const runSource = (source: string) => this.sandbox.run(source, '{}')
    const v: Judged = await judge({ move, bytes, data, code, budget: codeBudget(budget, { know, hot }), runSource })
    if (v.hit && side === 0 && !tutorial && code) {
      const next = await learnFromHit({ readers, type, code, data, bytes, dex, runSource })
      if (next !== readers) this.memory.setReaders(req.attackerPersonality, next)
    }
    const verdict: Verdict = v.hit ? 'hit' : 'miss'
    const reason = v.reason as MissReason | undefined
    const made = v.payload
    if (v.hit && made) this.options.payload?.deliver(made.kind, made.bytes) // before the reply: the game plays it as it takes the hit
    await this.panel.end(side, { verdict, ...(reason ? { reason } : {}), text: v.hit ? `${attacker}'s code hit!` : missText(attacker, reason ?? 'crashed'), ...(v.got ? { detail: `returned ${v.got}, needed ${v.want}` } : v.error ? { detail: v.error } : {}) })
    this.mailbox.reply(req, verdict, reason ?? 'crashed')
    if (side === 0) this.memory.remember?.(req.attackerPersonality, { at: Date.now(), move: move.name, type, target, verdict, ...(reason ? { reason } : {}), notch, budget, code: (code ?? '').slice(0, 1200) })
    this.options.onTurn?.({ side, attacker, target, move: move.name, type, tutorial, know: know?.from ?? null, notch, verdict, ...(reason ? { reason } : {}), ms: Date.now() - started, tries, ...(code ? { code: code.slice(0, 600) } : {}), ...(v.hit && made ? { payload: made.kind } : {}), ...(doubt?.notch ? { doubt: doubt.notch } : {}) })
  }
}

/** Code memory in the page's local storage (per browser; moves with cloud saves later). */
export function localCodeMemory(storage: Pick<Storage, 'getItem' | 'setItem'> | null, key = 'code-red-code-memory-v1'): CodeMemory {
  type State = { mons: Record<string, Readers>; hot: Record<string, string>; seen: string[]; recent: Record<string, CodeTurn[]> }
  let state: State = { mons: {}, hot: {}, seen: [], recent: {} }
  try { const raw = storage?.getItem(key); if (raw) state = { ...state, ...JSON.parse(raw) as Partial<State> } } catch { /* fresh */ }
  const save = () => { try { storage?.setItem(key, JSON.stringify(state)) } catch { /* in memory only */ } }
  const add = (list: string[], more: string[]) => { for (const t of more) if (!list.includes(t)) list.push(t); save() }
  return {
    readers: pid => ({ ...(state.mons[String(pid)] ?? {}) }),
    setReaders: (pid, readers) => { state.mons[String(pid)] = readers; save() },
    hot: pid => state.hot[String(pid)] ?? '',
    setHot: (pid, text) => { state.hot[String(pid)] = text; save() },
    seen: () => [...state.seen],
    addSeen: types => add(state.seen, types),
    recent: pid => [...(state.recent[String(pid)] ?? [])],
    remember: (pid, turn) => { const list = state.recent[String(pid)] ??= []; list.push(turn); if (list.length > HISTORY) list.splice(0, list.length - HISTORY); save() },
    export: () => JSON.parse(JSON.stringify(state)) as unknown,
    import: incoming => {
      const next = (incoming && typeof incoming === 'object' ? incoming : {}) as Partial<State>
      state = { mons: next.mons ?? {}, hot: next.hot ?? {}, seen: Array.isArray(next.seen) ? next.seen : [], recent: next.recent ?? {} }
      save()
    },
  }
}

/** Offline writer (stand-in model): writes plausible code: a reader line for the format, then the move.
 *  Every `missEvery`-th move it makes a beginner's mistake (forgets to read the format, or is off by one).
 *  For tests, demos and playing without a backend (?agents=mock). Not the real model. */
export function mockWriter(options: { missEvery?: number; chunk?: number; delay?: (ms: number) => Promise<void> } = {}): CodeWriter {
  const missEvery = options.missEvery ?? 4, chunk = options.chunk ?? 6
  const delay = options.delay ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)))
  let n = 0
  return {
    async write(prompt, onText) {
      const { move, type, tutorial } = prompt.meta
      const wrong = ++n % missEvery === 0
      const src = move.ref.toString().replace(/^\(?\s*b?\s*\)?\s*=>\s*/, '')
      const offByOne = wrong && (n % 2 === 1 || tutorial) && !src.startsWith('{')
      const reader = tutorial || (wrong && !offByOne) ? 'const nums = data' : HINTS[type]
      const uses = (name: string) => new RegExp(`\\b${name}\\(`).test(src)
      const helpers = [
        uses('sum') && 'const sum = xs => xs.reduce((a, x) => a + x, 0)',
        uses('max') && 'const max = xs => Math.max(...xs)',
        uses('min') && 'const min = xs => Math.min(...xs)',
        uses('asc') && 'const asc = xs => [...xs].sort((x, y) => x - y)',
      ].filter(Boolean).map(h => `  ${h}`)
      let body = src.replace(/\bb\b/g, 'nums')
      if (offByOne) body = move.shape === 'a list' ? `(${body}).slice(1) // skip the first, surely` : `(${body}) + 1 // grab one more`
      const lines = body.startsWith('{')
        ? body.slice(1, -1).trim().split(/;\s*|\n/).filter(Boolean).map(l => `  ${l.trim()}`)
        : [`  return ${body}`]
      const text = ['```js', `function ${move.fn}(data) {`, `  ${reader}`, ...helpers, ...lines, '}', '```'].join('\n')
      for (let i = 0; i < text.length; i += chunk) { onText(text.slice(i, i + chunk)); await delay(25) }
      return text
    },
  }
}
