// Byte-battle mailbox (ROM: patches/006-byte-battles.patch, struct CodeRedBattleBytes, 48 B).
//   0 u32 magic 'CRB1'  4 u16 version=1  6 u8 state (0 idle, 1 pending, 2 reply, 4 cancelled)  7 u8 enabled (host)
//   8 u32 requestId  12 u32 epoch (host stamps)  16 u16 move  18 u8 attackerSide  19 u8 moveType
//  20 u16 power  22 u8 level  23 u8 crit  24 u16 attack  26 u16 defense  28 u16 attackerSpecies
//  30 u16 targetSpecies  32 u16 targetHp  34 u16 targetMaxHp  36 u16 vanilla  38 u16 status  40 u32 result
//  44 u16 waited  46 u16 unused
// The game waits (≤1800 frames) for a reply; no host / no reply → vanilla damage.
import type { GbaMemory } from './memory.ts'

export const BYTES_MAGIC = 0x31425243
export const BYTES_SIZE = 48
export const BYTES_MAX = 999

export interface ByteRequest {
  id: number; epoch: number; move: number; attackerSide: 0 | 1; moveType: number
  power: number; level: number; crit: boolean; attack: number; defense: number
  attackerSpecies: number; targetSpecies: number; targetHp: number; targetMaxHp: number; vanilla: number
}

export class ByteMailbox {
  private readonly memory: GbaMemory
  private readonly address: number
  constructor(memory: GbaMemory, address: number) { this.memory = memory; this.address = address }

  /** Turn byte battles on (idempotent; the game clears RAM on reset). */
  enable(on = true): void {
    const m = this.memory, a = this.address
    if (!m.ready()) return
    if (m.u32(a) !== BYTES_MAGIC || m.u16(a + 4) !== 1) { m.w32(a, BYTES_MAGIC); m.w16(a + 4, 1); m.w8(a + 6, 0) }
    if (m.u8(a + 7) !== (on ? 1 : 0)) m.w8(a + 7, on ? 1 : 0)
  }

  snapshot(): ByteRequest | null {
    const m = this.memory, a = this.address
    if (!m.ready() || m.u32(a) !== BYTES_MAGIC || m.u16(a + 4) !== 1 || m.u8(a + 6) !== 1) return null
    const epoch = m.epoch()
    const stamped = m.u32(a + 12)
    if (stamped === 0) m.w32(a + 12, epoch)
    else if (stamped !== epoch) { m.w8(a + 6, 4); return null }
    return {
      id: m.u32(a + 8), epoch, move: m.u16(a + 16), attackerSide: (m.u8(a + 18) & 1) as 0 | 1, moveType: m.u8(a + 19),
      power: m.u16(a + 20), level: m.u8(a + 22), crit: m.u8(a + 23) !== 0, attack: m.u16(a + 24), defense: m.u16(a + 26),
      attackerSpecies: m.u16(a + 28), targetSpecies: m.u16(a + 30), targetHp: m.u16(a + 32), targetMaxHp: m.u16(a + 34), vanilla: m.u16(a + 36),
    }
  }

  reply(request: ByteRequest, bytes: number | null): boolean {
    const m = this.memory, a = this.address
    if (!m.ready() || m.u32(a) !== BYTES_MAGIC || m.u8(a + 6) !== 1 || m.u32(a + 8) !== request.id
      || m.u32(a + 12) !== request.epoch || m.epoch() !== request.epoch) return false
    const ok = bytes !== null && Number.isInteger(bytes) && bytes >= 1 && bytes <= BYTES_MAX
    m.w16(a + 38, ok ? 0 : 1)
    m.w32(a + 40, ok ? bytes : 0)
    m.w8(a + 6, 2) // publish last
    return true
  }
}
