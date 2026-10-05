// Calculation mailbox (ROM: patches/002-runner-mailbox.patch, struct CodeRedMailbox, 36 B).
// Port of the former bridge/mailbox.c; layout and rules unchanged.
//   0 u32 magic 'CRD1'   4 u16 version=1   6 u16 state (0 idle, 1 pending, 2 reply, 4 cancelled)
//   8 u32 requestId     12 u32 epoch      16 u16 operation (1 stats sum, 2 scratchpad)
//  18 u16 status (0 ok, 1 runner error, 2 closed/cancelled)  20 u16 stats[6]  32 u32 result
import type { GbaMemory } from './memory.ts'

export const CALC_MAGIC = 0x31445243
export const CALC_BYTES = 36
export const RESULT_MAX = 1530
export const STATE = { idle: 0, pending: 1, reply: 2, cancelled: 4 } as const

export interface CalcRequest { id: number; epoch: number; operation: 1 | 2; stats: number[] }

export class CalcMailbox {
  private readonly memory: GbaMemory
  private readonly address: number
  constructor(memory: GbaMemory, address: number) { this.memory = memory; this.address = address }

  private valid(): boolean {
    return this.memory.u32(this.address) === CALC_MAGIC && this.memory.u16(this.address + 4) === 1
  }

  /** A pending, current-epoch request, or null. Stamps unstamped requests and
   *  cancels requests stamped by an earlier epoch (restored state / reset). */
  snapshot(): CalcRequest | null {
    const m = this.memory, a = this.address
    if (!m.ready() || !this.valid() || m.u16(a + 6) !== STATE.pending) return null
    const operation = m.u16(a + 16)
    if (operation !== 1 && operation !== 2) return null
    const epoch = m.epoch()
    const stamped = m.u32(a + 12)
    if (stamped === 0) m.w32(a + 12, epoch)
    else if (stamped !== epoch) { m.w16(a + 6, STATE.cancelled); return null }
    const stats = Array.from({ length: 6 }, (_, i) => m.u16(a + 20 + 2 * i))
    if (stats.some(value => value > 255)) return null
    return { id: m.u32(a + 8), epoch, operation, stats }
  }

  reply(request: CalcRequest, status: 0 | 1 | 2, result: number): boolean {
    const m = this.memory, a = this.address
    if (!m.ready() || !this.valid() || m.u16(a + 6) !== STATE.pending || m.epoch() !== request.epoch
      || m.u32(a + 12) !== request.epoch || m.u32(a + 8) !== request.id
      || !Number.isInteger(result) || result < 0 || result > RESULT_MAX) return false
    m.w16(a + 18, status)
    m.w32(a + 32, result)
    m.w16(a + 6, STATE.reply) // publish last
    return true
  }
}
