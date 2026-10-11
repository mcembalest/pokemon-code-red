// Code moves, host side: when a Pokémon gets to use a move (ROM: patches/006-code-moves.patch), it writes
// the move's function (model through the backend), the code runs on the target's bytes in the sandbox, and
// the game hears hit / miss / vanilla. Both sides. The rules are shared with the simulator (rules/).
//   turn pace (owner, 2026-10-08): your code → your move → foe's code → foe's move (the ROM asks in that order)
//   foes: focus + budget from level; knowledge by tier (owner, 2026-10-08): wild none, trainers half the formats, leaders and the rival all
//   memory: each Pokémon remembers how it read a format from its own past hits (no Pokédex or badge readers, 2026-10-11)
//   model or network failure: retry once, then plain FireRed (accuracy roll)
import {
  BADGES, GROWTH, HINTS, budgetAt, byFireRed, byName, codeBudget, contextCost, extractCode, focusAt, formatOf, judge, knowFor, learnFromHit, missText, notchOf,
  rng, stageOf, targetBytes, tokenCapFor, turnData, turnPrompt, turnType,
  type Know, type Move, type Readers, type RunResult, type TypeName, type Verdict as Judged, type Helper,
  checkSource, consolidatePrompt, recall, extractHelpers, withoutCarried, fitHelpers, helpersFromReaders, helpersSource, libCap, mergeHelpers, workCap,
} from '../../../rules/index.mjs'
import { BATTLE_TYPE_FIRST_BATTLE, BATTLE_TYPE_TRAINER, type CodeMoveMailbox, type MissReason, type MoveRequest, type Verdict } from '../bridge/code-move.ts'
import type { PayloadMailbox, PayloadKind } from '../bridge/payload.ts'

export interface Names { moveName(id: number): string; speciesName(id: number): string; typeName(id: number): string }
export interface Prompt {
  system: string; user: string; temperature: number
  /** The model's token cap, derived from the byte budget (a safety stop, not a rule). */
  maxTokens: number
  /** For mock writers (tests, offline play); a real model only sees system + user. */
  meta: { move: Move; type: TypeName; tutorial: boolean; remember?: { carried: Helper[]; cap: number } }
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
  /** Your Pokémon doubted your call and used its own pick (this move); `called` = the move you called. */
  doubt?: { called: string | null }
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
  /** Long-term memory (2026-10-11): helpers it kept between battles, rewritten by itself when a battle ends. */
  lib(personality: number): Helper[]
  setLib(personality: number, helpers: Helper[]): void
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
  /** It doubted your call (the move you called). */
  doubted?: string
  /** Bytes of memory it carried this turn (long-term + working + your note), and the helpers by name. */
  memory?: number
  carried?: string[]
  /** Its code called one of the helpers it carried. */
  usedMemory?: boolean
  /** Helpers it kept for the rest of the battle after this turn. */
  kept?: string[]
}

/** A Pokémon consolidated its memory when a battle ended: what it carried, and what it kept. */
export interface RememberRecord { attacker: string; level: number; cap: number; before: Helper[]; carried: Helper[]; after: Helper[]; ok: boolean; reason?: string; ms: number }

export interface CodeBattleOptions {
  /** Badge names the player holds (BADGES keys), e.g. from the save's badge flags. */
  badges?: () => string[]
  onTurn?: (record: TurnRecord) => void
  /** Where a move's bytes (a sound, a picture) go so the game can play or draw them on the hit. */
  payload?: PayloadMailbox
  /** Doubt (rules/doubt.mjs; the ROM rolls it): the name of the move you called when it used its own pick instead. */
  calledMove?: (req: MoveRequest) => string | null
  /** A Pokémon consolidated its memory (end of a battle). */
  onRemember?: (record: RememberRecord) => void
}

/** Working memory of one Pokémon this battle: its helpers, and how each did (shown to it when it consolidates). */
type Work = { name: string; level: number; helpers: Helper[]; stats: Record<string, { used: number; hits: number }> }

/** The end-of-battle consolidation is not a move; mock writers see this in meta.move. */
const REMEMBER = { name: 'REMEMBER', fn: 'remember', spec: '', shape: 'no key', ref: () => null } as unknown as Move

export class CodeBattle {
  private pending = false
  private seenNow = new Set<string>()
  /** Working memory: helpers each of your Pokémon kept this battle (gone when it ends, after consolidation). */
  private work = new Map<number, Work>()
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

  /** The battle ended: each of your Pokémon that fought consolidates its memory (one model call each, in order);
   *  working memory is gone. Resolves when all are done. */
  async battleOver(): Promise<void> {
    if (this.seenNow.size) this.memory.addSeen([...this.seenNow])
    this.seenNow.clear()
    const fought = [...this.work]
    this.work.clear()
    for (const [pid, w] of fought) await this.consolidate(pid, w).catch(() => {})
  }

  private async consolidate(pid: number, w: Work): Promise<void> {
    const before = this.lib(pid), cap = libCap(w.level), started = Date.now()
    if (!w.helpers.length) return // nothing new this battle: long-term memory stays as it was
    const prompt = consolidatePrompt({ self: { name: w.name, level: w.level }, lib: before, work: w.helpers, cap, stats: w.stats })
    const carried = mergeHelpers(before, w.helpers)
    const record = (after: Helper[], ok: boolean, reason?: string) => this.options.onRemember?.({ attacker: w.name, level: w.level, cap, before, carried, after, ok, ...(reason ? { reason } : {}), ms: Date.now() - started })
    let text: string
    try {
      text = await this.writer.write({ ...prompt, temperature: focusAt(w.level, GROWTH), maxTokens: tokenCapFor(cap) + 60, meta: { move: REMEMBER, type: 'NORMAL', tutorial: false, remember: { carried, cap } } }, () => {})
    } catch { record(before, false, 'network'); return }
    const { code } = extractCode(text)
    const found = extractHelpers(code)
    const ok = found.length ? await this.compiles(found) : []
    const after = fitHelpers(ok, cap) // may lose things (owner, 2026-10-11)
    this.memory.setLib(pid, after)
    record(after, true)
  }

  /** The helpers that pass the check (rules/memory.mjs checkSource): compile, and a reading helper reads right. */
  private async compiles(helpers: Helper[], turn: { type: string; data: unknown; bytes: number[] } | null = null): Promise<Helper[]> {
    if (!helpers.length) return []
    const passed = (r: RunResult) => (r.ok && r.value && typeof r.value === 'object' ? r.value as Record<string, boolean> : null)
    const all = passed(await this.sandbox.run(checkSource(helpers, turn), '{}'))
    if (all) return helpers.filter(h => all[h.name] === true)
    const out: Helper[] = [] // one bad helper broke the lot: check each on its own
    for (const h of helpers) { const r = passed(await this.sandbox.run(checkSource([h], turn), '{}')); if (r?.[h.name] === true) out.push(h) }
    return out
  }

  /** Its long-term memory (a save from before 2026-10-11 brings its learned readers along as helpers). */
  private lib(pid: number): Helper[] {
    const lib = this.memory.lib(pid)
    if (lib.length) return lib
    const old = helpersFromReaders(this.memory.readers(pid))
    if (old.length) { this.memory.setLib(pid, old); this.memory.setReaders(pid, {}) }
    return old
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
    // No readers (owner, 2026-10-11): yours reads by instinct or with the helpers it carries (memory); foes by instinct alone.
    const know = null as Know | null
    const remembers = side === 0 && !tutorial
    const pid = req.attackerPersonality
    const lib = remembers ? this.lib(pid) : [], work = remembers ? (this.work.get(pid)?.helpers ?? []) : []
    const prelude = helpersSource(recall(mergeHelpers(lib, work), type)) // what it recalls this turn (rules/memory.mjs)
    const carried = recall(mergeHelpers(lib, work), type).map(h => h.name)
    const hot = side === 0 ? this.memory.hot(req.attackerPersonality).trim() : ''
    const doubt = side === 0 && req.calledSlot ? { called: this.options.calledMove?.(req) ?? null } : null
    const notch = notchOf(req.attackerStages)
    const budget = budgetAt(req.attackerLevel, { stage, badges, notch })
    const memoryCost = contextCost({ know, hot }) // + the helpers its code calls, known once it has written it
    const prompt = turnPrompt({ self: { name: attacker, level: req.attackerLevel, wild: side === 1 && wild }, target: { name: target, level: req.targetLevel, types }, move, type, know, budget, tutorial, hot, memory: remembers ? { lib, work } : null })

    this.panel.begin({ side, attacker, target, move: move.name, spec: move.spec, fn: move.fn, type, tutorial, know: know?.from ?? null, budget, wild, notch, memoryCost, ...(move.payload ? { makes: move.payload.kind } : {}), ...(doubt ? { doubt } : {}) })
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
    // Re-writing a helper it already carries costs nothing: it is defined already. Calling one costs its size.
    const judged = remembers ? withoutCarried(code, mergeHelpers(lib, work)) : code
    const used = judged ? carried.filter(n => new RegExp(`(?<!(?:function|const|let|var)\\s+)\\b${n}\\b`).test(judged)) : []
    const charged = helpersSource(mergeHelpers(lib, work).filter(h => used.includes(h.name)))
    const v: Judged = await judge({ move, bytes, data, code: judged, budget: codeBudget(budget, { know, hot, memory: charged }), runSource, prelude })
    // Working memory: the my… helpers its code defined in a hit, kept for the battle if they check out.
    let kept: string[] | undefined
    if (remembers && code && v.hit) {
      const fresh = await this.compiles(extractHelpers(code), { type, data, bytes })
      if (fresh.length) {
        const helpers = fitHelpers(mergeHelpers(work, fresh), workCap(budget))
        const w = this.work.get(pid)
        this.work.set(pid, { name: attacker, level: req.attackerLevel, helpers, stats: w?.stats ?? {} })
        kept = helpers.map(h => h.name)
      }
    }
    if (remembers && !this.work.has(pid)) this.work.set(pid, { name: attacker, level: req.attackerLevel, helpers: [], stats: {} })
    else if (remembers) this.work.get(pid)!.level = req.attackerLevel
    const usedMemory = used.length > 0
    if (remembers) { const st = this.work.get(pid)!.stats; for (const n of used) { const e = (st[n] ??= { used: 0, hits: 0 }); e.used++; if (v.hit) e.hits++ } }
    const verdict: Verdict = v.hit ? 'hit' : 'miss'
    const reason = v.reason as MissReason | undefined
    const made = v.payload
    if (v.hit && made) this.options.payload?.deliver(made.kind, made.bytes, made.palette) // before the reply: the game plays it as it takes the hit
    await this.panel.end(side, { verdict, ...(reason ? { reason } : {}), text: v.hit ? `${attacker}'s code hit!` : missText(attacker, reason ?? 'crashed'), ...(v.got ? { detail: `returned ${v.got}, needed ${v.want}` } : v.error ? { detail: v.error } : {}) })
    this.mailbox.reply(req, verdict, reason ?? 'crashed')
    if (side === 0) this.memory.remember?.(req.attackerPersonality, { at: Date.now(), move: move.name, type, target, verdict, ...(reason ? { reason } : {}), notch, budget, code: (code ?? '').slice(0, 1200) })
    this.options.onTurn?.({ side, attacker, target, move: move.name, type, tutorial, know: know?.from ?? null, notch, verdict, ...(reason ? { reason } : {}), ms: Date.now() - started, tries, ...(code ? { code: code.slice(0, 600) } : {}), ...(v.hit && made ? { payload: made.kind } : {}), ...(doubt ? { doubted: doubt.called ?? '?' } : {}), ...(remembers ? { memory: memoryCost + charged.length, carried, usedMemory, ...(kept ? { kept } : {}) } : {}) })
  }
}

/** Code memory in the page's local storage (per browser; moves with cloud saves later). */
export function localCodeMemory(storage: Pick<Storage, 'getItem' | 'setItem'> | null, key = 'code-red-code-memory-v1'): CodeMemory {
  type State = { mons: Record<string, Readers>; lib: Record<string, Helper[]>; hot: Record<string, string>; seen: string[]; recent: Record<string, CodeTurn[]> }
  let state: State = { mons: {}, lib: {}, hot: {}, seen: [], recent: {} }
  try { const raw = storage?.getItem(key); if (raw) state = { ...state, ...JSON.parse(raw) as Partial<State> } } catch { /* fresh */ }
  const save = () => { try { storage?.setItem(key, JSON.stringify(state)) } catch { /* in memory only */ } }
  const add = (list: string[], more: string[]) => { for (const t of more) if (!list.includes(t)) list.push(t); save() }
  return {
    readers: pid => ({ ...(state.mons[String(pid)] ?? {}) }),
    setReaders: (pid, readers) => { state.mons[String(pid)] = readers; save() },
    lib: pid => (state.lib[String(pid)] ?? []).map(h => ({ ...h })),
    setLib: (pid, helpers) => { state.lib[String(pid)] = helpers.map(h => ({ name: h.name, src: h.src })); save() },
    hot: pid => state.hot[String(pid)] ?? '',
    setHot: (pid, text) => { state.hot[String(pid)] = text; save() },
    seen: () => [...state.seen],
    addSeen: types => add(state.seen, types),
    recent: pid => [...(state.recent[String(pid)] ?? [])],
    remember: (pid, turn) => { const list = state.recent[String(pid)] ??= []; list.push(turn); if (list.length > HISTORY) list.splice(0, list.length - HISTORY); save() },
    export: () => JSON.parse(JSON.stringify(state)) as unknown,
    import: incoming => {
      const next = (incoming && typeof incoming === 'object' ? incoming : {}) as Partial<State>
      state = { mons: next.mons ?? {}, lib: next.lib ?? {}, hot: next.hot ?? {}, seen: Array.isArray(next.seen) ? next.seen : [], recent: next.recent ?? {} }
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
      const { move, type, tutorial, remember } = prompt.meta
      if (remember) { // end of battle: keep the most recent helpers that fit
        const text = ['```js', helpersSource(fitHelpers(remember.carried, remember.cap)), '```'].join('\n')
        onText(text); return text
      }
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
        ? /for\s*\(/.test(body) ? [`  ${body.slice(1, -1).trim()}`] // a loop: keep it on one line (splitting at ; would break the for header)
          : body.slice(1, -1).trim().split(/;\s*|\n/).filter(Boolean).map(l => `  ${l.trim()}`)
        : [`  return ${body}`]
      // Memory: a correct reader goes into a my… helper it keeps; once it carries one, it just calls it.
      const helperName = `myRead${type[0]}${type.slice(1).toLowerCase()}`
      const carries = prompt.user.includes(`function ${helperName}(data) {`) // its own helper, as it wrote it (not the prompt's example)
      const keep = !tutorial && reader !== 'const nums = data' && !carries ? [`function ${helperName}(data) { ${reader}; return nums }`] : []
      const readLine = !tutorial && reader !== 'const nums = data' ? `const nums = ${helperName}(data)` : reader
      const text = ['```js', ...keep, `function ${move.fn}(data) {`, `  ${readLine}`, ...helpers, ...lines, '}', '```'].join('\n')
      for (let i = 0; i < text.length; i += chunk) { onText(text.slice(i, i + chunk)); await delay(25) }
      return text
    },
  }
}
