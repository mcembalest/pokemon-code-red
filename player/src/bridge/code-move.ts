// Code-move mailbox (ROM: patches/006-code-moves.patch, struct CodeRedMove, 48 B).
//   0 u32 magic 'CRM1'  4 u16 version=1  6 u8 state (0 idle, 1 pending, 2 reply, 4 cancelled)  7 u8 enabled (host)
//   8 u32 requestId  12 u32 epoch (host stamps)  16 u16 move  18 u8 attackerSide  19 u8 attackerLevel
//  20 u16 attackerSpecies  22 u16 targetSpecies  24 u32 attackerPersonality  28 u32 targetPersonality
//  32 u8 targetLevel  33 u8 targetType1  34 u8 targetType2  35 u8 verdict (host: 0 vanilla, 1 hit, 2 miss)
//  36 u32 battleTypeFlags  40 u16 trainerId (0 = wild)  42 u8 reason (host)  43 s8 attackerStages (sum of stat stage offsets)  44 u16 waited  46 u8 trainerClass (0 = wild)
//  47 u8 calledSlot (0 = it used your call; n = it doubted you and used its own pick, you had called slot n−1)
// When a Pokémon gets to use a move the game waits (≤1800 frames) for a verdict; no host / no reply → plain FireRed.
import type { GbaMemory } from './memory.ts'

export const MOVE_MAGIC = 0x314D5243
export const MOVE_SIZE = 48
export const BATTLE_TYPE_TRAINER = 1 << 3
export const BATTLE_TYPE_FIRST_BATTLE = 1 << 4

export type Verdict = 'vanilla' | 'hit' | 'miss'
export type MissReason = 'crashed' | 'wrong answer' | 'over budget' | 'no code'
const VERDICT: Record<Verdict, number> = { vanilla: 0, hit: 1, miss: 2 }
const REASON: Record<MissReason, number> = { crashed: 0, 'wrong answer': 1, 'over budget': 2, 'no code': 3 }

export interface MoveRequest {
  id: number; epoch: number; move: number; attackerSide: 0 | 1; attackerLevel: number
  attackerSpecies: number; targetSpecies: number; attackerPersonality: number; targetPersonality: number
  targetLevel: number; targetTypes: [number, number]; battleTypeFlags: number; trainerId: number
  /** Sum of the attacker's stat stage offsets: Growl on it -1, its own Withdraw +1 (status moves hit the code). */
  attackerStages: number
  /** FireRed trainer class (0 for a wild battle): the knowledge tier. */
  trainerClass: number
  /** 0 = it used the move you called; n = it doubted your call (slot n−1) and used this move instead. */
  calledSlot: number
}

type Memory = Pick<GbaMemory, 'ready' | 'epoch' | 'u8' | 'u16' | 'u32' | 'w8' | 'w16' | 'w32'>

export class CodeMoveMailbox {
  private readonly memory: Memory
  private readonly address: number
  constructor(memory: Memory, address: number) { this.memory = memory; this.address = address }

  /** Turn code moves on (idempotent; the game clears RAM on reset). */
  enable(on = true): void {
    const m = this.memory, a = this.address
    if (!m.ready()) return
    if (m.u32(a) !== MOVE_MAGIC || m.u16(a + 4) !== 1) { m.w32(a, MOVE_MAGIC); m.w16(a + 4, 1); m.w8(a + 6, 0) }
    if (m.u8(a + 7) !== (on ? 1 : 0)) m.w8(a + 7, on ? 1 : 0)
  }

  snapshot(): MoveRequest | null {
    const m = this.memory, a = this.address
    if (!m.ready() || m.u32(a) !== MOVE_MAGIC || m.u16(a + 4) !== 1 || m.u8(a + 6) !== 1) return null
    const epoch = m.epoch()
    const stamped = m.u32(a + 12)
    if (stamped === 0) m.w32(a + 12, epoch)
    else if (stamped !== epoch) { m.w8(a + 6, 4); return null } // asked before a state load: let the game go on
    return {
      id: m.u32(a + 8), epoch, move: m.u16(a + 16), attackerSide: (m.u8(a + 18) & 1) as 0 | 1, attackerLevel: m.u8(a + 19),
      attackerSpecies: m.u16(a + 20), targetSpecies: m.u16(a + 22), attackerPersonality: m.u32(a + 24), targetPersonality: m.u32(a + 28),
      targetLevel: m.u8(a + 32), targetTypes: [m.u8(a + 33), m.u8(a + 34)], battleTypeFlags: m.u32(a + 36), trainerId: m.u16(a + 40),
      attackerStages: (m.u8(a + 43) << 24) >> 24, trainerClass: m.u8(a + 46), calledSlot: m.u8(a + 47),
    }
  }

  /** Answer a request. False if it is stale (another request, or a state load since). */
  reply(request: MoveRequest, verdict: Verdict, reason: MissReason = 'crashed'): boolean {
    const m = this.memory, a = this.address
    if (!m.ready() || m.u32(a) !== MOVE_MAGIC || m.u8(a + 6) !== 1 || m.u32(a + 8) !== request.id
      || m.u32(a + 12) !== request.epoch || m.epoch() !== request.epoch) return false
    m.w8(a + 35, VERDICT[verdict])
    m.w8(a + 42, REASON[reason] ?? 0)
    m.w8(a + 6, 2) // publish last
    return true
  }
}
