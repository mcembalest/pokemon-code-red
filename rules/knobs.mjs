// Every number that tunes Code Red, in one file. Change a value here, run `make test`, ship (CUSTOMIZING.md).
// The modules that use them import from here; each knob says what it does and where it bites.
// Content (move specs and names, data formats, prompt wording, payload voices) lives next door: see CUSTOMIZING.md.
//
// ROM-mirrored knobs: the game itself rolls doubt (patches/006, src/code_red_battle.c) and shows the PokÉEG's doubt
// number (patches/008). Those knobs are marked `rom`; changing them here changes only what the page shows and what
// the tests expect, until the C source is changed to match and `make patches build` is run.

/** How a Pokémon's coding grows with level and evolution. */
export const GROWTH = {
  startTemp: 0.8,      // focus = model temperature at level 5 (higher = wilder code)
  tempPerLevel: 0.03,  // temperature falls this much per level …
  minTemp: 0.3,        // … down to this floor
  budgetBase: 300,     // byte budget (characters of code, comments included) at level 0 (owner, 2026-10-08: base 300)
  budgetPerLevel: 10,  // + this per level
  evolutionBudget: 100, // + this per evolution stage (CHARMELEON +100, CHARIZARD +200)
  slotsBase: 2, levelsPerSlot: 3, evolutionSlots: 3, // retired (memory slots for readers); kept for the old journey lab
}

/** What badges do beyond FireRed's own effects. `budget` = extra bytes for the whole party. */
export const BADGES = {
  BOULDER: {},            // taught the ROCK and GROUND readers until readers went (owner, 2026-10-11); open: give it something
  CASCADE: { budget: 50 },
}

/** Status moves hit the code (owner, 2026-10-08): stat stages shake or steady the code brain, one notch per stage. */
export const NOTCH = {
  cap: 2,       // notches run −2 … +2
  temp: 0.1,    // each notch down adds this much temperature (up: subtracts)
  budget: 0.1,  // each notch down shrinks the byte budget by this fraction (up: grows)
}

/** Doubt (owner, 2026-10-10): chance it uses its own pick = cap × (1 − yours/its) × (1 − friendship/maxFriendship). rom */
export const DOUBT = {
  maxFriendship: 255, // FireRed's friendship scale; at this value it never doubts         rom: MAX_FRIENDSHIP
  cap: 0.5,           // the most it ever doubts a call (a call its instinct scores 0)      rom: `* 128` (= ½ of 256)
}

/** Memory is code (owner, 2026-10-11): what a Pokémon carries between turns and battles. */
export const MEMORY = {
  capBase: 80,      // long-term memory in characters at level 0 …
  capPerLevel: 5,   // … + this per level (105 at L5, 180 at L20, 280 at L40: a level-5 Pokémon keeps about one reader)
  workShare: 0.5,   // working memory may hold this share of the turn's budget …
  workMin: 200,     // … but at least this many characters (two or three readers)
}

/** Payload moves: bytes the game plays or draws. rom: patches/009 sizes the mailbox to these. */
export const PAYLOAD_LIMITS = {
  sampleRate: 8000, // Hz; the GBA cry player runs at 8 kHz (verified: sim/experiments/payload_audio.py)
  soundMax: 4096,   // samples per sound (~0.5 s)                                            rom: data[4096]
  imageFrames: 4,   // frames per picture, each 32×32 pixels of 16 colours                   rom: 4 × 512 B
}

/** Knowledge tiers: retired (owner, 2026-10-11: no readers; foes write on pure instinct). Kept for the model labs. */
export const KNOWLEDGE = { wild: 0, trainer: 0.5, boss: 1 }
/** FireRed trainer classes that count as bosses: Leader 84, Elite Four 87, Champion 90, rival 81/89, Boss (Giovanni) 83. */
export const BOSS_CLASSES = new Set([81, 83, 84, 87, 89, 90])

/** What the prompt calls the data and the variable (lab 3, 2026-10-08: 'bytes' halved first-time hits). */
export const WORDS = { data: 'numbers', v: 'nums' }
/** The numbers every move's spec is demonstrated on ("On the numbers [42,13,140,77] it returns …"). */
export const WORKED = [42, 13, 140, 77]
/** The example bytes every format is shown on ("Example: 'x42x13x140x' is [42, 13, 140]"). */
export const EXAMPLE_BYTES = [42, 13, 140]
/** The target's bytes each turn: this many distinct numbers in this range (never shown to the Pokémon). */
export const TARGET = { minCount: 4, maxCount: 7, low: 10, high: 199 }
