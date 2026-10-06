// Move scripts. Each move is a small, fixed script (language-neutral at first;
// runs in the QuickJS sandbox). A damaging move's script returns text: that
// output lands in the foe's context, and every byte it absorbs costs it 1 HP
// (then type match-ups, STAB, crits and the random roll apply as usual).
// Inputs: input.me {name, level, attack}, input.foe {name, defense, hp, maxHp}, input.move {name, power, type}.

// Gen 3 base damage, written out: how hard the hit lands.
const FORCE = `const force = Math.floor(Math.floor(Math.floor(2 * me.level / 5 + 2) * move.power * me.attack / foe.defense) / 50) + 2`

export interface MoveScript { name: string; file: string; source: string; damaging: boolean }

const script = (name: string, damaging: boolean, body: string): MoveScript => ({
  name, damaging, file: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.js`,
  source: `const { me, foe, move } = input\n${damaging ? FORCE + '\n' : ''}${body.trim()}`,
})

export const MOVE_SCRIPTS: Record<string, MoveScript> = {
  SCRATCH: script('SCRATCH', true, `
// Rake the foe's context with scratch marks: one byte per mark.
return '/'.repeat(force)`),
  TACKLE: script('TACKLE', true, `
// Slam a payload into the foe's context.
return 'THUD '.repeat(force).slice(0, force)`),
  POUND: script('POUND', true, `
// Hammer the same byte, over and over.
return '#'.repeat(force)`),
  EMBER: script('EMBER', true, `
// Sparks: a burst of hot bytes.
return '*~'.repeat(force).slice(0, force)`),
  GROWL: script('GROWL', false, `
// Status script: no bytes land. The foe's next scripts hit softer (ATTACK -1).
return foe.name + ': warning: attack lowered'`),
  'TAIL WHIP': script('TAIL WHIP', false, `
// Status script: no bytes land. The foe's guard drops (DEFENSE -1).
return foe.name + ': warning: defense lowered'`),
}

/** Any damaging move without its own script yet. */
export function scriptFor(moveName: string, damaging = true): MoveScript {
  return MOVE_SCRIPTS[moveName] ?? script(moveName, damaging, damaging ? `
// Generic hit: the move's name, then filler, until the force is spent.
const head = move.name + '! '
return (head + '.'.repeat(force)).slice(0, force)` : `
// Status script: no bytes land.
return move.name + ' used'`)
}

export const utf8Bytes = (text: string) => new TextEncoder().encode(text).length

/** Level-5 starters and their scripts (Pallet Town). Species ids: include/constants/species.h. */
export const STARTERS: Record<number, { name: string; moves: string[]; persona: string }> = {
  1: { name: 'BULBASAUR', moves: ['TACKLE', 'GROWL'], persona: 'Patient. Prefers steady, readable scripts.' },
  4: { name: 'CHARMANDER', moves: ['SCRATCH', 'GROWL'], persona: 'Hot-headed. Ships fast, fixes later.' },
  7: { name: 'SQUIRTLE', moves: ['TACKLE', 'TAIL WHIP'], persona: 'Calm. Defends first, then strikes.' },
}
