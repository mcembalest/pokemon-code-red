// Payload mailbox (ROM: patches/009-payload.patch, struct CodeRedPayload, 4156 B, version 2). A move that made bytes (a
// sound, a picture) hands them to the game here, already in GBA form, before the hit is reported; the game plays or
// draws them when it takes the hit and clears `kind`. The symbol gCodeRedPayload is a pointer: the game allocates the
// struct on its heap for the battle's duration and the pointer is 0 outside battle (nothing to deliver to).
//   0 u32 magic 'CRP1'  4 u16 version=2  6 u8 kind (0 none, 1 sound, 2 image)  7 u8 frames (image; sound: 1 = a voice)  8 u16 length
//  10 u16 played (game)  12 u16 palette[16] (BGR555; 0 = see-through)  44..59 wave header (the game fills it)
//  60 u8 data[4096]: sound = signed 8-bit samples at 8 kHz (played as the Pokémon's cry in the move's animation), or a
//     voice = one cycle of a wave (16–256 samples) that the move's own sound effects are played with; image = up to 4
//     frames of 16 4bpp tiles (a 32×32 sprite). The game keeps its own scratch after `data` (PAYLOAD_SIZE is the part
//     the page writes).
import type { GbaMemory } from './memory.ts'

export const PAYLOAD_MAGIC = 0x31505243
export const PAYLOAD_VERSION = 2
export const PAYLOAD_SIZE = 4156
export const PAYLOAD_BYTES = 4096
const DATA = 60, PALETTE = 12
const KIND = { sound: 1, voice: 1, image: 2 } as const
export type PayloadKind = keyof typeof KIND
export type Rgb = [number, number, number]

type Memory = Pick<GbaMemory, 'ready' | 'u8' | 'u16' | 'u32' | 'w8' | 'w16' | 'w32'>

/** The symbol holds a pointer into EWRAM (0x02000000–0x0203FFFF); 0 outside battle. */
export function deref(m: Pick<GbaMemory, 'ready' | 'u32'>, pointer: number): number {
  if (!m.ready()) return 0
  const a = m.u32(pointer)
  return a >= 0x02000000 && a + PAYLOAD_SIZE <= 0x02040000 ? a : 0
}

/** Color numbers 0–15, 1024 per frame, row by row (up to 4 frames) → 4bpp tiles, 512 bytes a frame, in the GBA's 1D 32×32 order. */
export function packImage(pixels: number[]): { tiles: Uint8Array; frames: number } {
  const frames = Math.max(1, Math.min(4, Math.floor(pixels.length / 1024)))
  const out = new Uint8Array(frames * 512)
  for (let f = 0; f < frames; f++) for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const c = Math.max(0, Math.min(15, Math.round(pixels[f * 1024 + y * 32 + x] ?? 0)))
    const at = f * 512 + ((y >> 3) * 4 + (x >> 3)) * 32 + (y & 7) * 4 + ((x & 7) >> 1)
    out[at] = x & 1 ? (out[at]! & 0x0F) | (c << 4) : (out[at]! & 0xF0) | c
  }
  return { tiles: out, frames }
}

/** Unsigned 0–255 samples (128 = silence) → signed 8-bit, at most 4096 (~0.5 s at 8 kHz). */
export function packSound(samples: number[]): Uint8Array {
  const n = Math.min(PAYLOAD_BYTES, samples.length)
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) out[i] = (Math.max(0, Math.min(255, Math.round(samples[i] ?? 128))) - 128) & 0xFF
  return out
}

/** [r, g, b] 0–255 → BGR555. */
export const bgr555 = ([r, g, b]: Rgb) => (r >> 3) | ((g >> 3) << 5) | ((b >> 3) << 10)
const GREYS: Rgb[] = Array.from({ length: 16 }, (_, i) => [i * 17, i * 17, i * 17])

export class PayloadMailbox {
  private readonly memory: Memory
  private readonly pointer: number
  /** `pointer`: the address of the ROM's gCodeRedPayload symbol (a pointer to the struct). */
  constructor(memory: Memory, pointer: number) { this.memory = memory; this.pointer = pointer }
  private at(): number { return deref(this.memory, this.pointer) }

  /** Hand the bytes to the game (an image in `palette`, 16 colors). Returns false when no battle holds a mailbox. */
  deliver(kind: PayloadKind, bytes: number[], palette: Rgb[] = GREYS): boolean {
    const m = this.memory, a = this.at()
    if (!a) return false
    m.w8(a + 6, 0)
    m.w32(a, PAYLOAD_MAGIC); m.w16(a + 4, PAYLOAD_VERSION)
    let data: Uint8Array
    if (kind === 'image') {
      const { tiles, frames } = packImage(bytes)
      data = tiles
      m.w8(a + 7, frames)
      for (let i = 0; i < 16; i++) m.w16(a + PALETTE + 2 * i, bgr555(palette[i] ?? [0, 0, 0]))
    } else {
      data = packSound(bytes)
      m.w8(a + 7, kind === 'voice' ? 1 : 0)
    }
    m.w16(a + 8, data.length)
    for (let i = 0; i < data.length; i++) m.w8(a + DATA + i, data[i]!)
    m.w8(a + 6, KIND[kind]) // publish last
    return true
  }

  /** How many payloads the game has played or drawn so far. */
  played(): number { const m = this.memory, a = this.at(); return a && m.u32(a) === PAYLOAD_MAGIC && m.u16(a + 4) === PAYLOAD_VERSION ? m.u16(a + 10) : 0 }
}
