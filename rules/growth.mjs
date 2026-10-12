// How a Pokémon's coding grows (the numbers: rules/knobs.mjs).
//   focus = model temperature (calmer with level) · byte budget = max code size (code + the memory it carries into the prompt)
//   evolution = a big jump in budget · badges add bytes (owner, 2026-10-08)

import { BADGES, GROWTH, NOTCH } from './knobs.mjs'
export { BADGES, GROWTH, NOTCH }

/** Status moves hit the code (owner, 2026-10-08): stat stages shake or steady the code brain, one notch per stage,
 *  capped at ±2. A notch down makes the writing jittierier (+0.1 temperature) and the byte budget 10% smaller;
 *  a notch up does the reverse. Resets with the stages (switch-out). */
/** The notch from the sum of a Pokémon's stat stage offsets (Growl on it: -1; its own Withdraw: +1). */
export const notchOf = stageSum => Math.max(-NOTCH.cap, Math.min(NOTCH.cap, Math.trunc(stageSum || 0)))

/** Temperature for a Pokémon at this level, shaken or steadied by its notch. */
export const focusAt = (level, p = GROWTH, notch = 0) => Math.max(0.05, Math.max(p.minTemp, p.startTemp - p.tempPerLevel * (level - 5)) - NOTCH.temp * notch)

/** Max characters of code. stage = evolutions so far (CHARMANDER 0, CHARMELEON 1); badges = names held by the trainer. */
export function budgetAt(level, { stage = 0, badges = [], notch = 0 } = {}, p = GROWTH) {
  const bonus = badges.reduce((a, b) => a + (BADGES[b]?.budget ?? 0), 0)
  return Math.round((p.budgetBase + p.budgetPerLevel * level + p.evolutionBudget * stage + bonus) * (1 + NOTCH.budget * notch))
}

/** Evolutions so far, by species (FireRed names). Unlisted species count as 0 (first stage, or no evolution). */
const STAGE_1 = ['IVYSAUR', 'CHARMELEON', 'WARTORTLE', 'METAPOD', 'KAKUNA', 'PIDGEOTTO', 'RATICATE', 'FEAROW', 'ARBOK', 'RAICHU',
  'SANDSLASH', 'NIDORINA', 'NIDORINO', 'CLEFABLE', 'NINETALES', 'WIGGLYTUFF', 'GOLBAT', 'GLOOM', 'PARASECT', 'VENOMOTH', 'DUGTRIO',
  'PERSIAN', 'GOLDUCK', 'PRIMEAPE', 'ARCANINE', 'POLIWHIRL', 'KADABRA', 'MACHOKE', 'WEEPINBELL', 'TENTACRUEL', 'GRAVELER', 'RAPIDASH',
  'SLOWBRO', 'MAGNETON', 'DODRIO', 'DEWGONG', 'MUK', 'CLOYSTER', 'HAUNTER', 'HYPNO', 'KINGLER', 'ELECTRODE', 'EXEGGUTOR', 'MAROWAK',
  'WEEZING', 'RHYDON', 'SEADRA', 'SEAKING', 'STARMIE', 'GYARADOS', 'VAPOREON', 'JOLTEON', 'FLAREON', 'OMASTAR', 'KABUTOPS', 'DRAGONAIR']
const STAGE_2 = ['VENUSAUR', 'CHARIZARD', 'BLASTOISE', 'BUTTERFREE', 'BEEDRILL', 'PIDGEOT', 'NIDOQUEEN', 'NIDOKING', 'VILEPLUME',
  'POLIWRATH', 'ALAKAZAM', 'MACHAMP', 'VICTREEBEL', 'GOLEM', 'GENGAR', 'DRAGONITE']
export const stageOf = species => (STAGE_2.includes(species) ? 2 : STAGE_1.includes(species) ? 1 : 0)

/** The model's token cap is a safety stop derived from the budget, never a rule of its own: ~1 token per 2.5 characters, plus room for the fences. */
export const tokenCapFor = budget => Math.ceil(budget / 2.5) + 120
