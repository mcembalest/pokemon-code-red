// Code moves, host side: when a Pokémon gets to use a move (ROM: patches/006-code-moves.patch), it writes
// the move's function (model through the backend), the code runs on the target's bytes in the sandbox, and
// the game hears hit / miss / vanilla. Both sides. The rules are shared with the simulator (rules/).
//   turn pace (owner, 2026-10-08): your code → your move → foe's code → foe's move (the ROM asks in that order)
//   foes: wild = focus + budget from level, no readers; trainers read every format (owner, 2026-10-08: the asymmetry is the challenge)
//   memory: each Pokémon keeps its own readers; the Pokédex (types seen in past battles + badge readers) is shared
//   model or network failure: retry once, then plain FireRed (accuracy roll)
import {
  BADGES, FORMATS, GROWTH, HINTS, budgetAt, byFireRed, byName, extractCode, focusAt, formatOf, judge, knowFor, learnFromHit, missText, notchOf, partyDex,
  rng, slotsAt, stageOf, targetBytes, turnData, turnPrompt, turnType,
  type Know, type Move, type Readers, type RunResult, type TypeName, type Verdict as Judged,
} from '../../../rules/index.mjs'
import { BATTLE_TYPE_FIRST_BATTLE, BATTLE_TYPE_TRAINER, type CodeMoveMailbox, type MissReason, type MoveRequest, type Verdict } from '../bridge/code-move.ts'

export interface Names { moveName(id: number): string; speciesName(id: number): string; typeName(id: number): string }
export interface Prompt {
  system: string; user: string; temperature: number
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
  /** -2..2: how shaken (negative) or steadied the writer's code brain is this turn (status moves hit the code). */
  notch: number
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
  /** Types the party has battled (Pokédex readers). */
  seen(): string[]
  addSeen(types: string[]): void
}

export interface TurnRecord {
  side: 0 | 1; attacker: string; target: string; move: string; type: TypeName; tutorial: boolean; know: string | null; notch?: number
  verdict: Verdict; reason?: string; ms: number; tries: number; code?: string
}

export interface CodeBattleOptions {
  /** Badge names the player holds (BADGES keys), e.g. from the save's badge flags. */
  badges?: () => string[]
  onTurn?: (record: TurnRecord) => void
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
    const dex = side === 0 ? partyDex({ seen: this.memory.seen(), badges }) : wild ? [] : Object.keys(FORMATS)
    const know = tutorial ? null : knowFor(type, { dex, readers })
    const notch = notchOf(req.attackerStages)
    const budget = budgetAt(req.attackerLevel, { stage, badges, notch })
    const prompt = turnPrompt({ self: { name: attacker, level: req.attackerLevel, wild: side === 1 && wild }, target: { name: target, level: req.targetLevel, types }, move, type, know, budget, tutorial })

    this.panel.begin({ side, attacker, target, move: move.name, spec: move.spec, fn: move.fn, type, tutorial, know: know?.from ?? null, budget, wild, notch })
    let text: string | null = null, tries = 0
    while (text === null && tries < 2) {
      tries++
      try { text = await this.writer.write({ ...prompt, temperature: focusAt(req.attackerLevel, GROWTH, notch), meta: { move, type, tutorial } }, delta => this.panel.text(side, delta)) }
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
    const v: Judged = await judge({ move, bytes, data, code, budget, runSource })
    if (v.hit && side === 0 && !tutorial && code) {
      const next = await learnFromHit({ readers, type, code, data, bytes, slots: slotsAt(req.attackerLevel, { stage }), dex, runSource })
      if (next !== readers) this.memory.setReaders(req.attackerPersonality, next)
    }
    const verdict: Verdict = v.hit ? 'hit' : 'miss'
    const reason = v.reason as MissReason | undefined
    await this.panel.end(side, { verdict, ...(reason ? { reason } : {}), text: v.hit ? `${attacker}'s code hit!` : missText(attacker, reason ?? 'crashed'), ...(v.got ? { detail: `returned ${v.got}, needed ${v.want}` } : v.error ? { detail: v.error } : {}) })
    this.mailbox.reply(req, verdict, reason ?? 'crashed')
    this.options.onTurn?.({ side, attacker, target, move: move.name, type, tutorial, know: know?.from ?? null, notch, verdict, ...(reason ? { reason } : {}), ms: Date.now() - started, tries, ...(code ? { code: code.slice(0, 600) } : {}) })
  }
}

/** Code memory in the page's local storage (per browser; moves with cloud saves later). */
export function localCodeMemory(storage: Pick<Storage, 'getItem' | 'setItem'> | null, key = 'code-red-code-memory-v1'): CodeMemory {
  type State = { mons: Record<string, Readers>; seen: string[] }
  let state: State = { mons: {}, seen: [] }
  try { const raw = storage?.getItem(key); if (raw) state = { ...state, ...JSON.parse(raw) as Partial<State> } } catch { /* fresh */ }
  const save = () => { try { storage?.setItem(key, JSON.stringify(state)) } catch { /* in memory only */ } }
  const add = (list: string[], more: string[]) => { for (const t of more) if (!list.includes(t)) list.push(t); save() }
  return {
    readers: pid => ({ ...(state.mons[String(pid)] ?? {}) }),
    setReaders: (pid, readers) => { state.mons[String(pid)] = readers; save() },
    seen: () => [...state.seen],
    addSeen: types => add(state.seen, types),
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
