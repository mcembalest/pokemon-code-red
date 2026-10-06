// Prototype: drives battles with the lead Pokémon's agent. See battle.ts.
import type { Agent, DecisionRecord } from './agent.ts'
import { BattleReader, actionId, battleSpec, observe } from './battle.ts'

export const KEY = { A: 8, B: 0, RIGHT: 7, LEFT: 6, UP: 4, DOWN: 5 } as const

export interface Pad {
  press(key: number, holdFrames?: number, afterFrames?: number): Promise<void>
  pause(): void
  play(): void
}

export interface ThinkingUi {
  thinking(name: string, brain: string): void
  say(name: string, thought: string, action: string, note?: string): void
  hide(): void
}

export class BattleAutopilot {
  enabled = false
  turns = 0
  private busy = false
  private lastNudge = 0
  private timer: ReturnType<typeof setInterval> | undefined
  private last: { foe: string; foeHp: number; meHp: number } | null = null
  private readonly reader: BattleReader
  private readonly agent: Agent
  private readonly ui: ThinkingUi
  private readonly pad: Pad
  private readonly onDecision: (record: DecisionRecord) => void
  private readonly sayMs: number

  constructor(reader: BattleReader, agent: Agent, ui: ThinkingUi, pad: Pad, options: { onDecision?: (r: DecisionRecord) => void; sayMs?: number } = {}) {
    this.reader = reader; this.agent = agent; this.ui = ui; this.pad = pad
    this.onDecision = options.onDecision ?? (() => {})
    this.sayMs = options.sayMs ?? 1600
  }

  start(): () => void {
    this.timer = setInterval(() => { void this.tick() }, 100)
    return () => clearInterval(this.timer)
  }

  setEnabled(on: boolean): void {
    this.enabled = on
    if (!on) this.ui.hide()
  }

  async tick(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      const r = this.reader
      if (!r.inBattle()) { if (this.last) { this.last = null; this.ui.hide() } return }
      if (!this.enabled) return
      if (r.choosingAction()) {
        await this.cursorTo(() => r.actionCursor(), 0) // FIGHT
        await this.pad.press(KEY.A, 2, 8)
      } else if (r.choosingMove()) {
        await this.chooseMove()
      } else if (Date.now() - this.lastNudge > 400) {
        // Battle text waiting for a button (e.g. Oak's tutorial). B, not A: on a
        // "Will you switch POKéMON?" prompt B means NO.
        this.lastNudge = Date.now()
        await this.pad.press(KEY.B, 2, 4)
      }
    } finally { this.busy = false }
  }

  private async chooseMove(): Promise<void> {
    const r = this.reader
    const me = r.mon(0), foe = r.mon(1)
    if (this.last && this.last.foe === foe.name) {
      this.agent.noteResult(`foe HP ${this.last.foeHp}→${foe.hp}, your HP ${this.last.meHp}→${me.hp}`)
    }
    this.agent.setSpec(battleSpec(me))
    this.ui.thinking(me.name, this.agent.brainKind)
    this.pad.pause()
    let decision
    try {
      const out = await this.agent.turn({ text: observe(me, foe, r.isTrainer()), data: { me, foe } })
      decision = out.decision
      this.onDecision(out.record)
      const move = me.moves.find(m => actionId(m.name) === decision!.action) ?? me.moves[0]!
      this.ui.say(me.name, decision.thought, move.name, out.record.fallback ? 'fallback' : undefined)
      await new Promise(resolve => setTimeout(resolve, this.sayMs))
      this.pad.play()
      if (!this.enabled || !r.choosingMove()) return
      await this.cursorTo(() => r.moveCursor(), move.slot)
      this.last = { foe: foe.name, foeHp: foe.hp, meHp: me.hp }
      this.turns++
      await this.pad.press(KEY.A, 2, 8)
    } finally { this.pad.play() }
  }

  /** 2×2 menu: bit 0 = column, bit 1 = row. */
  private async cursorTo(read: () => number, target: number): Promise<void> {
    for (let i = 0; i < 4; i++) {
      const cur = read()
      if (cur === target) return
      if ((cur & 1) !== (target & 1)) await this.pad.press(target & 1 ? KEY.RIGHT : KEY.LEFT, 2, 4)
      else await this.pad.press(target >> 1 ? KEY.DOWN : KEY.UP, 2, 4)
    }
  }
}

/** GBA-style text box over the game screen. */
export function createThinkingBox(host: HTMLElement): ThinkingUi & { element: HTMLElement } {
  const box = document.createElement('div')
  box.className = 'code-red-agent-box'
  box.dataset.agentBox = ''
  box.hidden = true
  box.setAttribute('role', 'status')
  box.setAttribute('aria-live', 'polite')
  host.appendChild(box)
  let typing: ReturnType<typeof setInterval> | undefined
  const set = (head: string, body: string, foot = '') => {
    clearInterval(typing)
    box.hidden = false
    box.innerHTML = '<div class="code-red-agent-head"></div><div class="code-red-agent-body"></div><div class="code-red-agent-foot"></div>'
    box.children[0]!.textContent = head
    box.children[2]!.textContent = foot
    const target = box.children[1]!
    let i = 0
    typing = setInterval(() => { target.textContent = body.slice(0, ++i); if (i >= body.length) clearInterval(typing) }, 18)
  }
  return {
    element: box,
    thinking(name, brain) { set(`${name} is thinking…`, '', brain === 'cloud' ? 'Sonnet 5.5' : brain); box.classList.add('code-red-agent-busy') },
    say(name, thought, action, note) {
      box.classList.remove('code-red-agent-busy')
      set(name, `“${thought || '…'}”`, `▶ ${action}${note ? ` (${note})` : ''}`)
      box.dataset.turns = String(Number(box.dataset.turns || 0) + 1)
    },
    hide() { clearInterval(typing); box.hidden = true },
  }
}
