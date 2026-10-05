// Polls the calculation mailbox and answers requests: op 1 runs the fixed
// stats-sum in a disposable QuickJS worker; op 2 opens the scratchpad.
// Ported from the site's tools/code-red-runner/mailbox.js; behavior unchanged.
import { CalcMailbox, RESULT_MAX, type CalcRequest } from './calc.ts'

const STATS_SUM = 'return input.stats.reduce((sum, value) => sum + value, 0);'

export interface Runner {
  run(source: string, inputJSON: string): Promise<{ ok: boolean; value?: unknown; error?: string }>
  cancel(): void
  dispose(): void
}
export interface Interactive {
  open(request: CalcRequest, done: (result?: number) => void): void
  close(): void
}

const inRange = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= RESULT_MAX

export class CalcController {
  private pending: CalcRequest | null = null
  private disposed = false
  private readonly timer: ReturnType<typeof setInterval>
  private readonly hide = () => { if (document.hidden) this.cancel(true) }
  private readonly leave = () => this.cancel(true)

  private readonly mailbox: CalcMailbox
  private readonly runner: Runner
  private readonly interactive?: Interactive
  constructor(mailbox: CalcMailbox, runner: Runner, interactive?: Interactive) {
    this.mailbox = mailbox; this.runner = runner; this.interactive = interactive
    document.addEventListener('visibilitychange', this.hide)
    window.addEventListener('pagehide', this.leave)
    this.timer = setInterval(() => this.poll(), 16)
  }

  private same(a: CalcRequest | null, b: CalcRequest | null) {
    return !!a && !!b && a.id === b.id && a.epoch === b.epoch
  }

  cancel(reply = false) {
    const pending = this.pending
    this.pending = null
    this.runner.cancel()
    this.interactive?.close()
    if (reply && pending) this.mailbox.reply(pending, 2, 0)
  }

  poll() {
    if (this.disposed) return
    const current = this.mailbox.snapshot()
    if (this.pending && !this.same(current, this.pending)) this.cancel()
    if (document.hidden || !current || this.pending) return
    const pending = this.pending = current
    if (current.operation === 2 && this.interactive) {
      this.interactive.open(pending, result => {
        if (this.pending !== pending) return
        this.pending = null
        if (!this.same(this.mailbox.snapshot(), pending)) return
        this.mailbox.reply(pending, inRange(result) ? 0 : 2, inRange(result) ? result : 0)
      })
      return
    }
    this.runner.run(STATS_SUM, JSON.stringify({ stats: current.stats })).then(result => {
      if (this.pending !== pending) return
      if (!this.same(this.mailbox.snapshot(), pending)) { this.cancel(); return }
      this.pending = null
      const ok = result.ok && inRange(result.value)
      this.mailbox.reply(pending, ok ? 0 : 1, ok ? result.value as number : 0)
    }).catch(() => {
      if (this.pending !== pending) return
      this.pending = null
      this.mailbox.reply(pending, 1, 0)
    })
  }

  dispose() {
    if (this.disposed) return
    this.cancel(true)
    this.disposed = true
    clearInterval(this.timer)
    this.runner.dispose()
    document.removeEventListener('visibilitychange', this.hide)
    window.removeEventListener('pagehide', this.leave)
  }
}
