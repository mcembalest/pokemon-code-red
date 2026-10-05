// Naming mailbox (ROM: patches/005-text-entry.patch, struct CodeRedNamingMailbox, 60 B).
// Port of the former bridge/naming-transport.c; layout and rules unchanged.
//   0 u32 magic 'CRN1'  4 u16 version=1  6 u8 active  7 u8 maxLength
//   8 u32 session  12 u32 requestSession  16 u32 sequence  20 u32 ackSequence
//  24 u8 action (1 replace, 2 confirm)  25 u8 length  26 u8 status  27 u8 currentLength
//  28 u8 current[16]  44 u8 input[16]
import type { GbaMemory } from './memory.ts'

export const NAMING_MAGIC = 0x314e5243
export const NAMING_BYTES = 60
export const NAMING_LIMIT = 15
export const NAMING_ALLOWED = /^[A-Za-z0-9 .,!?/\-'"]*$/

export interface NamingState {
  maxLength: number; session: number; sequence: number; ackSequence: number
  action: number; status: number; current: string
}

export class NamingMailbox {
  private readonly memory: GbaMemory
  private readonly address: number
  constructor(memory: GbaMemory, address: number) { this.memory = memory; this.address = address }

  /** Active naming screen state, or null. */
  snapshot(): NamingState | null {
    const m = this.memory
    if (!m.ready()) return null
    const v = m.read(this.address, NAMING_BYTES)
    const view = new DataView(v.buffer)
    const maxLength = v[7]!, currentLength = v[27]!
    if (view.getUint32(0, true) !== NAMING_MAGIC || v[4] !== 1 || v[5] !== 0 || v[6] !== 1
      || !maxLength || maxLength > NAMING_LIMIT || !view.getUint32(8, true) || currentLength > maxLength) return null
    const current = String.fromCharCode(...v.subarray(28, 28 + currentLength))
    if (!NAMING_ALLOWED.test(current)) return null
    return {
      maxLength, session: view.getUint32(8, true), sequence: view.getUint32(16, true),
      ackSequence: view.getUint32(20, true), action: v[24]!, status: v[26]!, current,
    }
  }

  /** Queue a replacement (1) or confirmation (2). Newer sequences replace older pending ones. */
  write(epoch: number, session: number, sequence: number, action: 1 | 2, text: string): boolean {
    const state = this.snapshot(), m = this.memory, a = this.address
    if (!state || epoch !== m.epoch() || session !== state.session || !sequence
      || sequence <= state.ackSequence || (state.action && sequence <= state.sequence)
      || (action !== 1 && action !== 2) || text.length > state.maxLength || text.length > NAMING_LIMIT
      || !NAMING_ALLOWED.test(text)) return false
    const input = new Uint8Array(16)
    for (let i = 0; i < text.length; i++) input[i] = text.charCodeAt(i)
    m.w8(a + 24, 0)
    m.w32(a + 12, session)
    m.w32(a + 16, sequence)
    m.w8(a + 25, text.length)
    m.write(a + 44, input)
    m.w8(a + 24, action) // publish last
    return true
  }
}
