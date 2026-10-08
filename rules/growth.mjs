// How a Pokémon's coding grows (tested in the journey simulator, not yet formally approved; calibration sets the numbers).
//   focus = model temperature (calmer with level) · byte budget = max code size · slots = how many readers it remembers
//   evolution = a big jump in budget and slots · badges teach (owner, 2026-10-08)

export const GROWTH = {
  startTemp: 0.8, tempPerLevel: 0.03, minTemp: 0.3,          // focus
  budgetBase: 200, budgetPerLevel: 10, evolutionBudget: 100,  // byte budget (characters of code, comments included)
  slotsBase: 2, levelsPerSlot: 3, evolutionSlots: 3,          // memory slots for readers
}

/** Badges teach: Boulder Badge = the ROCK and GROUND readers for the whole party; Cascade Badge = +50 bytes. */
export const BADGES = {
  BOULDER: { readers: ['ROCK', 'GROUND'] },
  CASCADE: { budget: 50 },
}

/** Temperature for a Pokémon at this level. */
export const focusAt = (level, p = GROWTH) => Math.max(p.minTemp, p.startTemp - p.tempPerLevel * (level - 5))

/** Max characters of code. stage = evolutions so far (CHARMANDER 0, CHARMELEON 1); badges = names held by the trainer. */
export function budgetAt(level, { stage = 0, badges = [] } = {}, p = GROWTH) {
  const bonus = badges.reduce((a, b) => a + (BADGES[b]?.budget ?? 0), 0)
  return p.budgetBase + p.budgetPerLevel * level + p.evolutionBudget * stage + bonus
}

/** How many learned readers a Pokémon keeps. */
export const slotsAt = (level, { stage = 0 } = {}, p = GROWTH) =>
  Math.max(1, p.slotsBase + Math.floor((level - 5) / p.levelsPerSlot) + p.evolutionSlots * stage)

/** The party's Pokédex: types whose reader every Pokémon may use (types seen in battle, plus badge readers). */
export function partyDex({ seen = [], badges = [] } = {}) {
  const out = new Set(seen)
  for (const b of badges) for (const t of BADGES[b]?.readers ?? []) out.add(t)
  return [...out]
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
