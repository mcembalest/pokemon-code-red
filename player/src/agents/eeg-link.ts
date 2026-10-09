// The in-game PokÉEG ↔ the page (bridge/eeg.ts). The game lists the Pokémon; the page answers with each
// one's mind, opens its note editor when the player picks "Hot memory", and keeps its own PokÉEG panel
// on the same Pokémon as the in-game cursor while the screen is up.
import { FORMATS, budgetAt, focusAt, partyDex, stageOf } from '../../../rules/index.mjs'
import type { TypeName } from '../../../rules/index.mjs'
import type { EegMailbox, EegRequest, Mind } from '../bridge/eeg.ts'
import type { CodeMemory } from './code-battle.ts'

export interface EegLinkOptions {
  mailbox: EegMailbox
  minds: CodeMemory
  badges: () => string[]
  speciesName: (species: number) => string
  /** The Pokémon's system: its first type as a format name. */
  typeOf: (species: number) => TypeName
  /** Edit a note on the page; resolves with the new text, or null when cancelled. The signal fires when the game cancels (B). */
  editor: (personality: number, name: string, current: string, signal: AbortSignal) => Promise<string | null>
  /** The game's screen opened / moved its cursor / closed: the page's panel follows. */
  follow?: (personality: number | null) => void
}

export function mindOf(o: { personality: number; species: number; level: number }, c: Pick<EegLinkOptions, 'minds' | 'badges' | 'speciesName' | 'typeOf'>): Mind {
  const badges = c.badges()
  const name = c.speciesName(o.species)
  const type = c.typeOf(o.species)
  return {
    readers: Object.keys(c.minds.readers(o.personality)).length,
    dex: partyDex({ seen: c.minds.seen(), badges }).length,
    budget: budgetAt(o.level, { stage: stageOf(name), badges }),
    focus: Math.round(focusAt(o.level) * 100),
    history: (c.minds.recent?.(o.personality) ?? []).slice(-10).map(t => t.verdict === 'hit'),
    format: FORMATS[type]?.short ?? 'plain list',
    hot: c.minds.hot(o.personality),
  }
}

export class EegLink {
  private lastId = -1
  private wasOpen = false
  private shown: number | null = null
  private editing: { req: EegRequest; abort: AbortController } | null = null
  private readonly o: EegLinkOptions
  constructor(o: EegLinkOptions) { this.o = o }

  /** Call often (every few frames). */
  poll(): void {
    const open = this.o.mailbox.open()
    if (open && (!this.wasOpen || open.personality !== this.shown)) { this.shown = open.personality; this.o.follow?.(open.personality || null) }
    if (!open && this.wasOpen) { this.shown = null; this.o.follow?.(null) }
    this.wasOpen = !!open
    const req = this.o.mailbox.snapshot()
    if (this.editing && (!req || req.id !== this.editing.req.id)) { this.editing.abort.abort(); this.editing = null } // the game gave up (B, or a state load)
    if (!req || req.id === this.lastId) return
    this.lastId = req.id
    if (req.op === 1) {
      this.o.mailbox.reply(req, mindOf(req, this.o))
      return
    }
    const abort = new AbortController()
    this.editing = { req, abort }
    void this.o.editor(req.personality, this.o.speciesName(req.species), this.o.minds.hot(req.personality), abort.signal).then(text => {
      if (this.editing?.req.id !== req.id) return
      this.editing = null
      if (text === null) this.o.mailbox.cancel(req)
      else { this.o.minds.setHot(req.personality, text); this.o.mailbox.done(req) }
    })
  }

  get editingNow(): boolean { return this.editing !== null }
}
