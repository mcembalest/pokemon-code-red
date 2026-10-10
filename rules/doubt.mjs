// Doubt (owner, 2026-10-10): only wild Pokémon pick their own moves (System 1). A Pokémon in your party uses the move
// you call, unless its instinct disagrees: then, with chance
//     ½ × (1 − score(your call) / score(its pick)) × (8 − badges) / 8
// it uses its own pick instead ("CHARMANDER doubted your call!"). Same rule in every battle, gyms included; it costs
// only the move (the code is written for the move it actually used). The ½ cap keeps status and payload moves usable
// at 0 badges. Its System 1 = "the move that hits hardest now": power × accuracy × type effectiveness × STAB.
// The ROM rolls this (patch 006, CodeRedDoubts); these functions mirror it for the page and the tests.

export const DOUBT = { badgesToTrust: 8, cap: 0.5 }

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

/** 1 with no badges, 0 at 8: how far its instinct can overrule you. */
export const misalignment = badges => Math.max(0, 1 - Math.min(DOUBT.badgesToTrust, badges.length) / DOUBT.badgesToTrust)
/** The most it ever doubts a call (a call its instinct scores 0): 0.5 with no badges, 0 at 8. */
export const maxDoubt = badges => DOUBT.cap * misalignment(badges)

/** Chance it uses its own pick instead of `chosen`, and that pick. */
export function doubtChance({ chosen, moves, badges = [], selfTypes = [], effectiveness }) {
  const ctx = { selfTypes, effectiveness }
  const want = instinct(moves, ctx)
  if (!want || want === chosen || (chosen && want.id !== undefined && want.id === chosen.id)) return { chance: 0, wanted: null }
  const mine = instinctScore(chosen, ctx), best = instinctScore(want, ctx)
  if (mine >= best) return { chance: 0, wanted: null }
  return { chance: maxDoubt(badges) * (1 - mine / best), wanted: want }
}

/** FireRed's type chart from the ROM image: rows of (attacker type, defender type, ×10), 0xFE = foresight marker, 0xFF = end. */
export function typeChart(rom, at) {
  const chart = new Map()
  for (let p = at; rom[p] !== 0xFF; p += 3) if (rom[p] !== 0xFE) chart.set(rom[p] * 256 + rom[p + 1], rom[p + 2] / 10)
  return (moveType, defTypes) => [...new Set(defTypes)].reduce((m, t) => m * (chart.get(moveType * 256 + t) ?? 1), 1)
}
