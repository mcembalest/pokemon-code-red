// The PokÉEG brain scan, page side: the same picture the in-game screen draws (patches/008-pokeeg.patch,
// code_red_eeg.c), from the same numbers, so the panel and the game agree. Display only (owner, 2026-10-10): built
// from what a Pokémon already is in FireRed (nature, IVs, EVs, friendship) and from its code memory.
//   brain: five lobes, one per stat a nature touches; the raised one glows, the lowered one dims.
//   electrodes: IVs (twelve, two per stat); brighter for better wiring.
//   channels: BOND (friendship), WIRING (IVs), TRAINING (EVs), MEMORY (last ten turns: spike = hit, sag = miss).
// 168 × 88 pixels, the GBA's 15-bit colours; the page scales it up with image-rendering: pixelated.

export const NATURES = ['HARDY', 'LONELY', 'BRAVE', 'ADAMANT', 'NAUGHTY', 'BOLD', 'DOCILE', 'RELAXED', 'IMPISH', 'LAX',
  'TIMID', 'HASTY', 'SERIOUS', 'JOLLY', 'NAIVE', 'MODEST', 'MILD', 'QUIET', 'BASHFUL', 'RASH', 'CALM', 'GENTLE', 'SASSY', 'CAREFUL', 'QUIRKY']
/** FireRed's stat order (IVs, EVs). */
export const STATS = ['HP', 'ATTACK', 'DEFENSE', 'SPEED', 'SP. ATK', 'SP. DEF']
/** A nature's raised and lowered stat, as indexes into STATS (equal: neither). */
export const natureStats = (nature: number) => ({ up: 1 + Math.floor(nature / 5), down: 1 + nature % 5 })
/** The tabs, in the game's order. */
export const TABS = ['NATURE', 'WIRING', 'TRAINING', 'BOND', 'CODE', 'MEMORY', 'NOTE'] as const

export interface ScanMon { personality: number; friendship: number; ivs: number[]; evs: number[] }

export const W = 168, H = 88
const HEAD_W = 80, CX = 40, CY = 45, SKULL_R = 35, TRACE_X0 = 80 + 2, TRACE_W = 84, CH_H = 22, WAVE = 128

const rgb = (r: number, g: number, b: number): [number, number, number] => [r * 8 + (r >> 2), g * 8 + (g >> 2), b * 8 + (b >> 2)]
const PANEL = rgb(2, 4, 6), SKULL = rgb(6, 10, 10), SKULL_LIT = rgb(15, 19, 19), DIM = rgb(6, 10, 10), MID = rgb(15, 19, 19), BRIGHT = rgb(31, 27, 12)
export const CHANNELS = [
  { name: 'BOND', tab: 'BOND', color: rgb(30, 11, 15) },
  { name: 'WIRING', tab: 'WIRING', color: rgb(11, 23, 30) },
  { name: 'TRAINING', tab: 'TRAINING', color: rgb(30, 20, 8) },
  { name: 'MEMORY', tab: 'MEMORY', color: rgb(11, 28, 14) },
] as const
// ATTACK, DEFENSE, SPEED, SP. ATK, SP. DEF (a nature's order); physical left, special right, SPEED at the back
const LOBES = [
  { x: -12, y: -15, c: [31, 13, 7] }, { x: -13, y: 3, c: [29, 23, 9] }, { x: 0, y: 19, c: [15, 29, 12] },
  { x: 12, y: -15, c: [10, 19, 31] }, { x: 13, y: 3, c: [9, 27, 25] },
]
const ELECTRODES = [[0, -35], [18, -30], [30, -18], [35, 0], [30, 18], [18, 30], [0, 35], [-18, 30], [-30, 18], [-35, 0], [-30, -18], [-18, -30]]

/** FireRed's gSineTable: sin(i·π/128) in Q8.8. */
export const SINE = Array.from({ length: 256 }, (_, i) => Math.trunc(Math.sin(i * Math.PI / 128) * 256 + (i < 128 ? 0.5 : -0.5)) | 0)
const sin = (i: number, amp: number) => (amp * SINE[i & 0xFF]!) >> 8

const inBrain = (x: number, y: number) => x !== 0 && 4 * (x - (x > 0 ? 14 : -14)) ** 2 * 729 + y * y * 841 <= 841 * 729

// What each head pixel is: 0 nothing, 1 panel, 2 skull, 10+2·lobe core, 11+2·lobe halo.
const HEAD: Uint8Array = (() => {
  const m = new Uint8Array(HEAD_W * H).fill(1)
  const put = (x: number, y: number, v: number) => { if (x >= 0 && y >= 0 && x < HEAD_W && y < H) m[y * HEAD_W + x] = v }
  for (let y = -29; y <= 29; y++) for (let x = -31; x <= 31; x++) {
    if (!inBrain(x, y)) continue
    let best = Infinity, lobe = 0
    LOBES.forEach((l, i) => { const d = (x - l.x) ** 2 * 100 + (y - l.y) ** 2 * 121; if (d < best) { best = d; lobe = i } })
    const core = 10 + lobe * 2, halo = core + 1, odd = (x + y) & 1
    put(CX + x, CY + y, best < 3660 ? core : best < 7744 ? (odd ? halo : core) : best < 14641 ? halo : (odd ? 1 : halo))
  }
  for (let y = -27; y <= 27; y += 4) for (let x = -30; x <= 30; x++) {
    const v = SINE[(x * 37 + y * 41) & 0xFF]!, yy = y + Math.trunc((v * 3 + (v >= 0 ? 256 : -256)) / 512)
    if (((x * 7 + y * 13) & 7) && inBrain(x, yy)) put(CX + x, CY + yy, 1)
  }
  for (let y = -28; y <= 28; y++) put(CX, CY + y, 1)
  let ox = SKULL_R, oy = 0, err = 1 - SKULL_R
  while (ox >= oy) {
    for (const [a, b] of [[ox, oy], [oy, ox]] as const) for (const sx of [-1, 1]) for (const sy of [-1, 1]) put(CX + sx * a, CY + sy * b, 2)
    oy++
    if (err < 0) err += 2 * oy + 1; else { ox--; err += 2 * (oy - ox) + 1 }
  }
  for (let i = -3; i <= 3; i++) put(CX + i, CY - SKULL_R - 3 + Math.abs(i), 2)
  for (let i = -4; i <= 4; i++) { put(CX - SKULL_R - 2 + (Math.abs(i) >> 1), CY + i, 2); put(CX + SKULL_R + 2 - (Math.abs(i) >> 1), CY + i, 2) }
  return m
})()

const clamp = (v: number) => Math.max(-5, Math.min(5, v))
function noise(seed: number) {
  let s = seed >>> 0
  return (amp: number) => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return amp ? ((s >>> 16) % (2 * amp + 1)) - amp : 0 }
}

/** The four channels, one 128-sample loop each. history: oldest first, true = hit; null = no memory yet (the page has none). */
export function waves(mon: ScanMon, history: boolean[] | null): Int8Array[] {
  const out = [0, 1, 2, 3].map(() => new Int8Array(WAVE))
  const n = noise(mon.personality)
  const tones = [2, 3, 5, 7, 11, 13]
  for (let i = 0; i < WAVE; i++) {
    const amp = 2 + Math.trunc(mon.friendship * 5 / 255), jitter = Math.trunc((255 - mon.friendship) * 4 / 255)
    out[0]![i] = clamp(sin(i * 8, amp) + n(jitter))
    let sum = 0
    for (let k = 0; k < 6; k++) sum += SINE[(i * tones[k]! * 2 + k * 40) & 0xFF]! * (mon.ivs[k] ?? 0)
    out[1]![i] = clamp(Math.trunc(sum * 22 / (31 * 256 * 10)))
    const block = Math.floor(i * 6 / WAVE), local = i * 6 - block * WAVE, env = SINE[(local >> 1) & 0xFF]!
    const evAmp = Math.max(320, Math.trunc((mon.evs[block] ?? 0) * 8 * 256 / 255))
    out[2]![i] = clamp(Math.trunc(evAmp * env / 65536) * ((i >> 1) & 1 ? 1 : -1))
  }
  const hit = [0, 0, -1, 7, -3, 1, 0], miss = [0, 0, 0, -2, -3, -2, 0]
  const m = noise(mon.personality ^ 0x5EED)
  const h = history?.slice(-10) ?? []
  for (let i = 0; i < WAVE; i++) {
    const slot = Math.floor(i * 10 / WAVE), local = i - Math.floor(slot * WAVE / 10)
    const v = history && slot < h.length && local < hit.length ? (h[slot] ? hit[local]! : miss[local]!) : 0
    out[3]![i] = clamp(v + ((i & 3) === 0 ? m(history ? 0 : 1) : 0))
  }
  return out
}

/** Its lobes' core and halo colours at this frame. mon null (nothing selected): all dim. */
export function lobeColors(nature: number | null, frame: number): [number, number, number][] {
  const out: [number, number, number][] = []
  const { up, down } = nature === null ? { up: 0, down: 0 } : natureStats(nature)
  LOBES.forEach((l, i) => {
    const s = SINE[(frame * 2 + i * 53) & 0xFF]!
    const [lo, hi] = nature === null ? [40, 70] : up !== down && i + 1 === up ? [205, 256] : up !== down && i + 1 === down ? [38, 77] : [115, 180]
    const k = lo + Math.trunc((hi - lo) * (s + 256) / 512)
    out.push(rgb(...(l.c.map(v => Math.trunc(v * k / 256)) as [number, number, number])), rgb(...(l.c.map(v => Math.trunc(v * k / 512)) as [number, number, number])))
  })
  return out
}

/** Draw one frame of the scan (168 × 88) into `img`. tab lights its channel (or the skull, for NATURE). */
export function drawScan(img: ImageData, o: { mon: ScanMon | null; nature: number | null; waves: Int8Array[] | null; frame: number; tab: string }) {
  const d = img.data
  const set = (x: number, y: number, c: readonly number[]) => { const p = (y * W + x) * 4; d[p] = c[0]!; d[p + 1] = c[1]!; d[p + 2] = c[2]!; d[p + 3] = 255 }
  const lobes = lobeColors(o.mon ? o.nature : null, o.frame)
  const skull = o.tab === 'NATURE' && o.mon ? SKULL_LIT : SKULL
  for (let y = 0; y < H; y++) for (let x = 0; x < HEAD_W; x++) {
    const v = HEAD[y * HEAD_W + x]!
    set(x, y, v === 2 ? skull : v >= 10 ? lobes[v - 10]! : PANEL)
  }
  ELECTRODES.forEach(([ex, ey], k) => {
    const iv = o.mon ? (o.mon.ivs[k % 6] ?? 0) : 0
    const c = iv >= 26 ? BRIGHT : iv >= 16 ? MID : DIM
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) set(CX + ex! + i, CY + ey! + j, c)
  })
  for (let y = 0; y < H; y++) for (let x = HEAD_W; x < W; x++) set(x, y, PANEL)
  const shift = o.frame >> 1
  CHANNELS.forEach((ch, c) => {
    const base = c * CH_H + 16
    for (let x = 3 - (shift & 3); x < TRACE_W; x += 4) set(TRACE_X0 + x, base, DIM)
    if (!o.mon || !o.waves) return
    let prev: number | null = null
    for (let x = 0; x < TRACE_W; x++) {
      const y = base - o.waves[c]![(x + shift) & (WAVE - 1)]!
      const from = prev ?? y
      for (let yy = Math.min(from, y); yy <= Math.max(from, y); yy++) set(TRACE_X0 + x, yy, ch.color)
      prev = y
    }
  })
}

/** Where each channel's label goes (the page prints them in its own pixel font over the canvas). */
export const channelLabels = () => CHANNELS.map((ch, c) => ({ ...ch, x: TRACE_X0, y: c * CH_H }))

/** rules/doubt.mjs maxDoubt, as the game shows it: percent, rounded. */
export const doubtPercent = (friendship: number) => Math.trunc((50 * (255 - friendship) + 127) / 255)
