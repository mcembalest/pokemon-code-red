// Payload mailbox (ROM: patches/009-payload.patch, struct CodeRedPayload, 540 B). A move that made bytes (a sound,
// a picture) hands them to the game here, already in GBA form, before the hit is reported; the game plays or draws
// them when it takes the hit and clears `kind`. The symbol gCodeRedPayload is a pointer: the game allocates the
// struct on its heap for the battle's duration and the pointer is 0 outside battle (nothing to deliver to).
//   0 u32 magic 'CRP1'  4 u16 version=1  6 u8 kind (0 none, 1 sound, 2 image)  8 u16 length  10 u16 played (game)
//  12 u16 waveType  14 u16 waveStatus  16 u32 waveFreq  20 u32 waveLoopStart  24 u32 waveSize (the game fills these)
//  28 u8 data[512]: sound = signed 8-bit samples at 8 kHz (≤ 512); image = 16 4bpp tiles of a 32×32 sprite, 16 greys
import type { GbaMemory } from './memory.ts'

export const PAYLOAD_MAGIC = 0x31505243
/** The symbol holds a pointer into EWRAM (0x02000000–0x0203FFFF); 0 outside battle. */
export function deref(m: Pick<GbaMemory, 'ready' | 'u32'>, pointer: number): number {
  if (!m.ready()) return 0
  const a = m.u32(pointer)
  return a >= 0x02000000 && a + PAYLOAD_SIZE <= 0x02040000 ? a : 0
}
export const PAYLOAD_SIZE = 540
export const PAYLOAD_BYTES = 512
const KIND = { sound: 1, image: 2 } as const
export type PayloadKind = keyof typeof KIND

type Memory = Pick<GbaMemory, 'ready' | 'u8' | 'u16' | 'u32' | 'w8' | 'w16' | 'w32'>

/** 1024 brightness bytes (row by row) → 512 bytes of 4bpp tiles, 16 shades, in the GBA's 1D 32×32 sprite order. */
export function packImage(pixels: number[]): Uint8Array {
  const out = new Uint8Array(PAYLOAD_BYTES)
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const shade = 1 + Math.round(Math.max(0, Math.min(255, pixels[y * 32 + x] ?? 0)) * 14 / 255) // 1..15: index 0 is transparent on the GBA
    const at = ((y >> 3) * 4 + (x >> 3)) * 32 + (y & 7) * 4 + ((x & 7) >> 1)
    out[at] = x & 1 ? (out[at]! & 0x0F) | (shade << 4) : (out[at]! & 0xF0) | shade
  }
  return out
}

/** Unsigned 0–255 samples (128 = silence) → signed 8-bit, at most 512. */
export function packSound(samples: number[]): Uint8Array {
  const n = Math.min(PAYLOAD_BYTES, samples.length)
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) out[i] = (Math.max(0, Math.min(255, samples[i] ?? 128)) - 128) & 0xFF
  return out
}

export class PayloadMailbox {
  private readonly memory: Memory
  private readonly pointer: number
  /** `pointer`: the address of the ROM's gCodeRedPayload symbol (a pointer to the struct). */
  constructor(memory: Memory, pointer: number) { this.memory = memory; this.pointer = pointer }
  private at(): number { return deref(this.memory, this.pointer) }

  /** Hand the bytes to the game. Returns false when memory is not ready or no battle holds a mailbox. */
  deliver(kind: PayloadKind, bytes: number[]): boolean {
    const m = this.memory, a = this.at()
    if (!a) return false
    const packed = kind === 'image' ? packImage(bytes) : packSound(bytes)
    m.w8(a + 6, 0)
    m.w32(a, PAYLOAD_MAGIC); m.w16(a + 4, 1)
    m.w16(a + 8, packed.length)
    for (let i = 0; i < packed.length; i++) m.w8(a + 28 + i, packed[i]!)
    m.w8(a + 6, KIND[kind]) // publish last
    return true
  }

  /** How many payloads the game has played or drawn so far. */
  played(): number { const m = this.memory, a = this.at(); return a && m.u32(a) === PAYLOAD_MAGIC ? m.u16(a + 10) : 0 }
}
