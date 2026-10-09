// How a Pokémon's coding grows (tested in the journey simulator, not yet formally approved; calibration sets the numbers).
//   focus = model temperature (calmer with level) · byte budget = max code size (code + the memory it carries into the prompt)
//   evolution = a big jump in budget and slots · badges teach (owner, 2026-10-08)

export const GROWTH = {
  startTemp: 0.8, tempPerLevel: 0.03, minTemp: 0.3,          // focus
  budgetBase: 300, budgetPerLevel: 10, evolutionBudget: 100,  // byte budget (characters of code, comments included); base 300 (owner, 2026-10-08)
  slotsBase: 2, levelsPerSlot: 3, evolutionSlots: 3,          // memory slots for readers
}

/** Badges teach: Boulder Badge = the ROCK and GROUND readers for the whole party; Cascade Badge = +50 bytes. */
export const BADGES = {
  BOULDER: { readers: ['ROCK', 'GROUND'] },
  CASCADE: { budget: 50 },
}

/** Status moves hit the code (owner, 2026-10-08): stat stages shake or steady the code brain, one notch per stage,
 *  capped at ±2. A notch down makes the writing jittierier (+0.1 temperature) and the byte budget 10% smaller;
 *  a notch up does the reverse. Resets with the stages (switch-out). */
export const NOTCH = { cap: 2, temp: 0.1, budget: 0.1 }
/** The notch from the sum of a Pokémon's stat stage offsets (Growl on it: -1; its own Withdraw: +1). */
export const notchOf = stageSum => Math.max(-NOTCH.cap, Math.min(NOTCH.cap, Math.trunc(stageSum || 0)))

/** Temperature for a Pokémon at this level, shaken or steadied by its notch. */
export const focusAt = (level, p = GROWTH, notch = 0) => Math.max(0.05, Math.max(p.minTemp, p.startTemp - p.tempPerLevel * (level - 5)) - NOTCH.temp * notch)

/** Max characters of code. stage = evolutions so far (CHARMANDER 0, CHARMELEON 1); badges = names held by the trainer. */
export function budgetAt(level, { stage = 0, badges = [], notch = 0 } = {}, p = GROWTH) {
  const bonus = badges.reduce((a, b) => a + (BADGES[b]?.budget ?? 0), 0)
  return Math.round((p.budgetBase + p.budgetPerLevel * level + p.evolutionBudget * stage + bonus) * (1 + NOTCH.budget * notch))
}

/** (Retired by the one-context-budget rule: readers cost bytes when used instead. Kept for the old journey sim.) */
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

/** Knowledge tiers (owner, 2026-10-08): the chance a foe's Pokémon can read any given format. Wild 0, ordinary
 *  trainers 0.5, gym leaders and the rival 1. Fixed per Pokémon and format for a whole battle (seeded). */
export const KNOWLEDGE = { wild: 0, trainer: 0.5, boss: 1 }
/** FireRed trainer classes that count as bosses: Leader 84, Elite Four 87, Champion 90, rival 81/89, Boss (Giovanni) 83. */
export const BOSS_CLASSES = new Set([81, 83, 84, 87, 89, 90])
export const tierOf = (trainerClass, wild) => (wild ? 'wild' : BOSS_CLASSES.has(trainerClass) ? 'boss' : 'trainer')
/** The formats a foe reads this battle: each format independently, with the tier's chance, seeded by the Pokémon. */
export function foeDex(tier, personality, formats, chance = KNOWLEDGE[tier]) {
  if (chance >= 1) return [...formats]
  if (chance <= 0) return []
  return formats.filter((t, i) => { let h = (personality ^ (i + 1) * 0x9e3779b9) >>> 0; h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0; h ^= h >>> 16; return (h >>> 0) / 4294967296 < chance })
}

/** The model's token cap is a safety stop derived from the budget, never a rule of its own: ~1 token per 2.5 characters, plus room for the fences. */
export const tokenCapFor = budget => Math.ceil(budget / 2.5) + 120
