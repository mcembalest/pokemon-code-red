// Access to GBA RAM through the ROM-agnostic Code Red core (core/adapter.inc).
// The core exposes only where EWRAM/IWRAM live in the WASM heap and an epoch
// that changes on reset / state load. Everything else is protocol code in JS.

export const CORE_ABI = 1
export const EWRAM = { base: 0x02000000, size: 0x40000 } as const
export const IWRAM = { base: 0x03000000, size: 0x8000 } as const

export interface CoreExports {
  HEAPU8: Uint8Array
  _ejs_cr_abi(): number
  _ejs_cr_epoch(): number
  _ejs_cr_ewram(): number
  _ejs_cr_ewram_size(): number
  _ejs_cr_iwram(): number
  _ejs_cr_iwram_size(): number
}

const REQUIRED = ['_ejs_cr_abi', '_ejs_cr_epoch', '_ejs_cr_ewram', '_ejs_cr_ewram_size', '_ejs_cr_iwram', '_ejs_cr_iwram_size'] as const

export function isCodeRedCore(module: unknown): module is CoreExports {
  return typeof module === 'object' && module !== null && REQUIRED.every(name => typeof (module as Record<string, unknown>)[name] === 'function')
}

export class GbaMemory {
  private readonly core: CoreExports
  constructor(core: CoreExports) {
    this.core = core
    if (!isCodeRedCore(core)) throw new Error('This emulator core has no Code Red exports.')
    const abi = core._ejs_cr_abi()
    if (abi !== CORE_ABI) throw new Error(`Code Red core ABI ${abi}, player expects ${CORE_ABI}.`)
  }

  /** Changes whenever the emulator resets or loads a state. */
  epoch(): number { return this.core._ejs_cr_epoch() >>> 0 }

  /** Fresh view each call: HEAPU8 is replaced when WASM memory grows. */
  private locate(address: number, length: number): { heap: Uint8Array; at: number } {
    const region = address >= IWRAM.base && address < IWRAM.base + IWRAM.size ? IWRAM : EWRAM
    const pointer = region === IWRAM ? this.core._ejs_cr_iwram() : this.core._ejs_cr_ewram()
    const size = region === IWRAM ? this.core._ejs_cr_iwram_size() : this.core._ejs_cr_ewram_size()
    const offset = address - region.base
    if (!pointer || size !== region.size) throw new Error('Game memory is not available yet.')
    if (!Number.isInteger(length) || length < 0 || offset < 0 || offset + length > size) {
      throw new RangeError(`Address ${address.toString(16)}+${length} is outside GBA RAM.`)
    }
    return { heap: this.core.HEAPU8, at: pointer + offset }
  }

  ready(): boolean {
    try { this.locate(EWRAM.base, 0); return true } catch { return false }
  }
  read(address: number, length: number): Uint8Array {
    const { heap, at } = this.locate(address, length)
    return heap.slice(at, at + length)
  }
  write(address: number, bytes: ArrayLike<number>): void {
    const { heap, at } = this.locate(address, bytes.length)
    heap.set(bytes, at)
  }
  u8(address: number): number { return this.read(address, 1)[0]! }
  u16(address: number): number { const b = this.read(address, 2); return b[0]! | b[1]! << 8 }
  u32(address: number): number { const b = this.read(address, 4); return (b[0]! | b[1]! << 8 | b[2]! << 16 | b[3]! << 24) >>> 0 }
  w8(address: number, value: number): void { this.write(address, [value & 0xff]) }
  w16(address: number, value: number): void { this.write(address, [value & 0xff, value >>> 8 & 0xff]) }
  w32(address: number, value: number): void { this.write(address, [value & 0xff, value >>> 8 & 0xff, value >>> 16 & 0xff, value >>> 24 & 0xff]) }
}

/** In-memory stand-in for the core, for tests and fixtures. */
export function fakeCore(): CoreExports & { bump(): void } {
  const HEAPU8 = new Uint8Array(0x60000)
  let epoch = 1
  const ewram = 0x8000, iwram = 0x50000
  return {
    HEAPU8,
    _ejs_cr_abi: () => CORE_ABI,
    _ejs_cr_epoch: () => epoch,
    _ejs_cr_ewram: () => ewram,
    _ejs_cr_ewram_size: () => EWRAM.size,
    _ejs_cr_iwram: () => iwram,
    _ejs_cr_iwram_size: () => IWRAM.size,
    bump() { epoch++ },
  }
}
