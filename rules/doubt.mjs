// Doubt (owner, 2026-10-09): only wild Pokémon pick their own moves (System 1). A Pokémon in your party uses the move
// you call — but it can disagree, to the exact proportional extent your pick is misaligned with what its own System 1
// would have picked, and that disagreement fades as you earn badges (your alignment with your Pokémon).
// Disagreement shows up as doubt: its code brain is shaken (a negative notch: hotter writing, a smaller budget), never
// a different move. Its System 1 today = "the move that hits hardest now": power × accuracy × type effectiveness × STAB.
import { NOTCH } from './growth.mjs'

export const DOUBT = { badgesToTrust: 8, maxNotch: 2 }

/** A move's worth in its instinct's eyes. effectiveness(moveType) → 0.25 … 4 against the foe. */
export function instinctScore(move, { selfTypes = [], effectiveness = () => 1 } = {}) {
  if (!move || !move.power) return 0
  const stab = selfTypes.includes(move.type) ? 1.5 : 1
  return move.power * ((move.accuracy || 100) / 100) * effectiveness(move.type) * stab
}

/** The move its System 1 would pick (null when nothing scores: all status moves). */
export function instinct(moves, ctx) {
  let best = null, score = 0
  for (const m of moves) { const s = instinctScore(m, ctx); if (s > score) { score = s; best = m } }
  return best
}

/** 0 = fully aligned (8 badges), 1 = no trust yet. */
export const misalignment = badges => Math.max(0, 1 - Math.min(DOUBT.badgesToTrust, badges.length) / DOUBT.badgesToTrust)
export const trust = badges => 1 - misalignment(badges)

/**
 * How much it disagrees with your pick, 0 … 1, scaled by misalignment. With no damaging move, nothing to disagree with.
 * Returns { doubt, notch (0, -1, -2), wanted (the move it would have used, or null) }.
 */
export function doubtOf({ chosen, moves, badges = [], selfTypes = [], effectiveness }) {
  const ctx = { selfTypes, effectiveness }
  const want = instinct(moves, ctx)
  if (!want) return { doubt: 0, notch: 0, wanted: null }
  const mine = instinctScore(chosen, ctx), best = instinctScore(want, ctx)
  const raw = best > 0 ? Math.max(0, 1 - mine / best) : 0
  const doubt = raw * misalignment(badges)
  const notch = 0 - Math.min(DOUBT.maxNotch, Math.round(doubt * DOUBT.maxNotch)) || 0
  return { doubt, notch, wanted: notch < 0 && want.id !== chosen?.id ? want : null }
}

/** The stat-stage notch and the doubt notch, together, within the cap. */
export const combinedNotch = (stageNotch, doubtNotch) => Math.max(-NOTCH.cap, Math.min(NOTCH.cap, stageNotch + doubtNotch))

/** FireRed's type chart from the ROM image: rows of (attacker type, defender type, ×10), 0xFE = foresight marker, 0xFF = end. */
export function typeChart(rom, at) {
  const chart = new Map()
  for (let p = at; rom[p] !== 0xFF; p += 3) if (rom[p] !== 0xFE) chart.set(rom[p] * 256 + rom[p + 1], rom[p + 2] / 10)
  return (moveType, defTypes) => [...new Set(defTypes)].reduce((m, t) => m * (chart.get(moveType * 256 + t) ?? 1), 1)
}
