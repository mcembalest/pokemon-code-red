// PokÉEG mailbox (ROM: patches/008-pokeeg.patch, struct CodeRedEeg, 260 B, version 2). The in-game PokÉEG screen
// asks the page for one Pokémon's mind at a time, and for the page's editor when the player picks
// "Hot memory"; the page's own panel follows the in-game cursor while the screen is open.
//   0 u32 magic 'CRE1'  4 u16 version  6 u8 state (0 idle, 1 request, 2 reply, 4 cancelled)  7 u8 op (1 mind, 2 edit hot)
//   8 u32 requestId  12 u32 epoch  16 u32 personality  20 u16 species  22 u8 level  23 u8 open (the screen is up)
//  24 u8 readers  25 u8 dex  26 u16 budget  28 u8 focus×100  29 u8 nHistory  30 u8 history[10]  40 u8 format[24]  64 u8 hot[100]
// 164 u8 readersText[48] ("Water, Rock")  212 u8 dexText[48]  — game text, EOS-terminated; hot may hold one newline (two lines)
import type { GbaMemory } from './memory.ts'

export const EEG_MAGIC = 0x31455243
export const EEG_SIZE = 260
export const EEG_VERSION = 2

export interface EegRequest { id: number; op: 1 | 2; personality: number; species: number; level: number }
export interface Mind { readers: number; dex: number; budget: number; focus: number; history: boolean[]; format: string; hot: string; readersText: string; dexText: string }

/** At most two lines of `width` characters (what the in-game NOTE tab holds); a longer note ends with …. */
export function wrapNote(text: string, width = 30): string {
  const lines: string[] = []
  let cur = ''
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (cur && cur.length + 1 + w.length > width) { lines.push(cur); cur = w }
    else cur = cur ? cur + ' ' + w : w
  }
  if (cur) lines.push(cur)
  const out = lines.slice(0, 2).join('\n')
  return lines.length > 2 ? out.slice(0, -1) + '…' : out
}

type Memory = Pick<GbaMemory, 'ready' | 'u8' | 'u16' | 'u32' | 'w8' | 'w16' | 'w32'>

// FireRed charmap, the subset notes need (reverse of agents/battle.ts decodeText).
const CHARS: Record<string, number> = { ' ': 0x00, 'É': 0x06, 'é': 0x1B, '!': 0xAB, '?': 0xAC, '.': 0xAD, '-': 0xAE, '·': 0xAF, '…': 0xB0, "'": 0xB4, '’': 0xB4, ',': 0xB8, '/': 0xBA, '×': 0xB9, '(': 0x5C, ')': 0x5D, ':': 0xF0, '“': 0xB1, '”': 0xB2, '"': 0xB2 }
export function encodeText(text: string, size: number): Uint8Array {
  const out = new Uint8Array(size).fill(0xFF)
  let i = 0
  for (const c of text) {
    if (i >= size - 1) break
    const code = c.charCodeAt(0)
    out[i++] = c === '\n' ? 0xFE : code >= 48 && code <= 57 ? 0xA1 + code - 48 : code >= 65 && code <= 90 ? 0xBB + code - 65 : code >= 97 && code <= 122 ? 0xD5 + code - 97 : CHARS[c] ?? 0xAC
  }
  return out
}

export class EegMailbox {
  private readonly memory: Memory
  private readonly address: number
  constructor(memory: Memory, address: number) { this.memory = memory; this.address = address }

  /** The in-game screen is open, and which Pokémon its cursor is on (0 = EXIT). */
  open(): { personality: number } | null {
    const m = this.memory, a = this.address
    if (!m.ready() || m.u32(a) !== EEG_MAGIC || m.u8(a + 23) !== 1) return null
    return { personality: m.u32(a + 16) >>> 0 }
  }

  snapshot(): EegRequest | null {
    const m = this.memory, a = this.address
    if (!m.ready() || m.u32(a) !== EEG_MAGIC || m.u16(a + 4) !== EEG_VERSION || m.u8(a + 6) !== 1) return null
    const op = m.u8(a + 7)
    if (op !== 1 && op !== 2) return null
    return { id: m.u32(a + 8) >>> 0, op, personality: m.u32(a + 16) >>> 0, species: m.u16(a + 20), level: m.u8(a + 22) }
  }

  private live(req: EegRequest): boolean {
    const m = this.memory, a = this.address
    return m.ready() && m.u32(a) === EEG_MAGIC && m.u8(a + 6) === 1 && (m.u32(a + 8) >>> 0) === req.id
  }

  /** Answer a mind request (op 1). */
  reply(req: EegRequest, mind: Mind): boolean {
    const m = this.memory, a = this.address
    if (!this.live(req)) return false
    m.w8(a + 24, Math.min(255, mind.readers)); m.w8(a + 25, Math.min(255, mind.dex)); m.w16(a + 26, Math.min(65535, mind.budget)); m.w8(a + 28, Math.max(0, Math.min(255, mind.focus)))
    const h = mind.history.slice(-10)
    m.w8(a + 29, h.length)
    for (let i = 0; i < 10; i++) m.w8(a + 30 + i, i < h.length && h[i] ? 1 : 0)
    encodeText(mind.format, 24).forEach((b, i) => m.w8(a + 40 + i, b))
    encodeText(wrapNote(mind.hot), 100).forEach((b, i) => m.w8(a + 64 + i, b))
    encodeText(mind.readersText, 48).forEach((b, i) => m.w8(a + 164 + i, b))
    encodeText(mind.dexText, 48).forEach((b, i) => m.w8(a + 212 + i, b))
    m.w8(a + 6, 2)
    return true
  }

  /** The editor closed (op 2): the game asks for the mind again. */
  done(req: EegRequest): boolean { if (!this.live(req)) return false; this.memory.w8(this.address + 6, 2); return true }
  cancel(req: EegRequest): boolean { if (!this.live(req)) return false; this.memory.w8(this.address + 6, 4); return true }
}
