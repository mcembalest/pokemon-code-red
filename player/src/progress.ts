// Progress tracking from game RAM (read-only). Offsets: pokefirered include/global.h,
// include/pokemon.h, include/constants/flags.h. Same offsets as sim/codered/world.py.
import { EWRAM } from './bridge/memory.ts'

export interface Memory { u8(a: number): number; u16(a: number): number; u32(a: number): number; read(a: number, n: number): Uint8Array }
export interface ProgressSymbols { saveBlock1Ptr: number; saveBlock2Ptr: number; partyCount: number; party: number }

const SB1_LOCATION = 0x004, SB1_FLAGS = 0x0EE0
const SB2_PLAY_HOURS = 0x00E, SB2_PLAY_MINUTES = 0x010, SB2_PLAY_SECONDS = 0x011
const FLAG_BADGE01_GET = 0x820, FLAG_SYS_POKEMON_GET = 0x828, FLAG_SYS_GAME_CLEAR = 0x82C
const MON_SIZE = 100, MON_LEVEL = 0x54

export interface Snapshot {
  play_s: number
  map: [number, number]   // [mapGroup, mapNum]
  badges: number          // bit i = badge i+1
  badge_count: number
  has_pokemon: boolean
  champion: boolean
  party: number[]         // levels
}

const inEwram = (p: number, n: number) => p >= EWRAM.base && p + n <= EWRAM.base + EWRAM.size
const s8 = (v: number) => v << 24 >> 24

export function readSnapshot(mem: Memory, sym: ProgressSymbols): Snapshot | null {
  try {
    const sb1 = mem.u32(sym.saveBlock1Ptr), sb2 = mem.u32(sym.saveBlock2Ptr)
    if (!inEwram(sb1, 0x1000) || !inEwram(sb2, 0x20)) return null
    const flag = (f: number) => (mem.u8(sb1 + SB1_FLAGS + (f >> 3)) >> (f & 7) & 1) === 1
    const badges = mem.u8(sb1 + SB1_FLAGS + (FLAG_BADGE01_GET >> 3)) // the 8 badge flags share one byte
    const count = Math.min(mem.u8(sym.partyCount), 6)
    const party: number[] = []
    for (let i = 0; i < count; i++) party.push(mem.u8(sym.party + i * MON_SIZE + MON_LEVEL))
    return {
      play_s: mem.u16(sb2 + SB2_PLAY_HOURS) * 3600 + mem.u8(sb2 + SB2_PLAY_MINUTES) * 60 + mem.u8(sb2 + SB2_PLAY_SECONDS),
      map: [s8(mem.u8(sb1 + SB1_LOCATION)), s8(mem.u8(sb1 + SB1_LOCATION + 1))],
      badges, badge_count: popcount(badges),
      has_pokemon: flag(FLAG_SYS_POKEMON_GET), champion: flag(FLAG_SYS_GAME_CLEAR), party,
    }
  } catch { return null }
}

function popcount(v: number): number { let n = 0; for (; v; v &= v - 1) n++; return n }

/**
 * Turns periodic snapshots into events. Only reports while the play-time clock
 * advances (i.e. in a loaded game, not on the title screen). The first playing
 * snapshot is the baseline: badges already owned are not re-reported.
 */
export class ProgressWatcher {
  private last: Snapshot | null = null
  private baseline: Snapshot | null = null
  private lastSnapshotAt = -Infinity
  private readonly read: () => Snapshot | null
  private readonly track: (kind: string, data?: unknown) => void
  private readonly snapshotEveryMs: number

  constructor(read: () => Snapshot | null, track: (kind: string, data?: unknown) => void, snapshotEveryMs = 60_000) {
    this.read = read; this.track = track; this.snapshotEveryMs = snapshotEveryMs
  }

  tick(now = Date.now()): void {
    const snap = this.read()
    if (!snap) return
    const prev = this.last
    this.last = snap
    if (!prev || snap.play_s === prev.play_s) return // not (yet) playing
    const base = this.baseline
    if (!base) {
      this.baseline = { ...snap }
      this.track('snapshot', snap); this.lastSnapshotAt = now
      return
    }
    if (snap.map[0] !== base.map[0] || snap.map[1] !== base.map[1]) {
      this.track('map', { map: snap.map, play_s: snap.play_s })
      base.map = snap.map
    }
    const gained = snap.badges & ~base.badges
    for (let i = 0; i < 8; i++) if (gained >> i & 1) this.track('badge', { n: i + 1, play_s: snap.play_s })
    base.badges |= snap.badges
    if (snap.has_pokemon && !base.has_pokemon) { this.track('first_pokemon', { party: snap.party, play_s: snap.play_s }); base.has_pokemon = true }
    if (snap.champion && !base.champion) { this.track('champion', { play_s: snap.play_s }); base.champion = true }
    if (now - this.lastSnapshotAt >= this.snapshotEveryMs) { this.track('snapshot', snap); this.lastSnapshotAt = now }
  }

  /** Final snapshot (e.g. on page hide) if anything was played since the last one. */
  finalSnapshot(now = Date.now()): void {
    if (this.baseline && this.last && now - this.lastSnapshotAt > 5_000) { this.track('snapshot', this.last); this.lastSnapshotAt = now }
  }
}
