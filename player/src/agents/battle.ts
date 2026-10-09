// Prototype (throwaway, behind ?agents=): the lead Pokémon is an agent that
// picks its own battle move. Its ≤4 moves are its ≤4 actions.
// Reads battle state from RAM and move/species names from the ROM image; drives
// the menus with simulated button presses (same approach as sim/codered/battle.py).
import type { AgentSpec, Decision, DecideRequest } from './agent.ts'
import { STARTERS, scriptFor } from './moves.ts'

// include/pokemon.h struct BattlePokemon (0x58 bytes)
const BMON = 0x58, SPECIES = 0x00, MOVES = 0x0C, TYPE1 = 0x21, TYPE2 = 0x22, PP = 0x24, HP = 0x28, LEVEL = 0x2A, MAXHP = 0x2C
const BATTLE_TYPE_TRAINER = 0x8
const MOVE_NAME = 13, SPECIES_NAME = 11, TYPE_NAME = 7, MOVE_DATA = 12

export interface BattleMemory { u8(a: number): number; u16(a: number): number; u32(a: number): number }
export type Symbols = Record<string, { address: number }>

export interface BattleMon {
  species: number; name: string; level: number; hp: number; maxHp: number; types: string[]
  moves: { slot: number; id: number; name: string; type: string; typeId: number; power: number; accuracy: number; pp: number; maxPp: number }[]
}

// FireRed charmap (pokefirered charmap.txt), enough for names.
const CHARS: Record<number, string> = { 0x00: ' ', 0x06: 'É', 0x1B: 'é', 0x5C: '(', 0x5D: ')', 0xAB: '!', 0xAC: '?', 0xAD: '.', 0xAE: '-', 0xAF: '·', 0xB0: '…', 0xB1: '“', 0xB2: '”', 0xB4: '’', 0xB5: '♂', 0xB6: '♀', 0xB8: ',', 0xB9: '×', 0xBA: '/', 0xF0: ':' }
export function decodeText(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) {
    if (b === 0xFF) break
    if (b >= 0xA1 && b <= 0xAA) out += String.fromCharCode(48 + b - 0xA1)
    else if (b >= 0xBB && b <= 0xD4) out += String.fromCharCode(65 + b - 0xBB)
    else if (b >= 0xD5 && b <= 0xEE) out += String.fromCharCode(97 + b - 0xD5)
    else out += CHARS[b] ?? '?'
  }
  return out
}

export class BattleReader {
  private readonly mem: BattleMemory
  private readonly rom: Uint8Array
  private readonly sym: (name: string) => number
  private readonly chooseAction: Set<number>
  private readonly chooseMove: Set<number>

  constructor(mem: BattleMemory, rom: Uint8Array, symbols: Symbols) {
    this.mem = mem; this.rom = rom
    this.sym = name => {
      const s = symbols[name]
      if (!s) throw new Error(`rom.json has no ${name}`)
      return s.address
    }
    this.chooseAction = new Set(['battle_controller_player.HandleInputChooseAction', 'battle_controller_oak_old_man.HandleInputChooseAction'].map(n => this.sym(n) & ~1))
    this.chooseMove = new Set(['battle_controller_player.HandleInputChooseMove', 'battle_controller_oak_old_man.OakOldManHandleInputChooseMove'].map(n => this.sym(n) & ~1))
  }

  static supported(symbols: Symbols): boolean {
    return ['BattleMainCB2', 'gBattleMons', 'gBattlerControllerFuncs', 'gMoveNames', 'battle_controller_player.HandleInputChooseMove'].every(n => n in symbols)
  }

  inBattle(): boolean { return (this.mem.u32(this.sym('gMain') + 4) & ~1) === (this.sym('BattleMainCB2') & ~1) }
  private controller(): number { return this.mem.u32(this.sym('gBattlerControllerFuncs')) & ~1 }
  choosingAction(): boolean { return this.inBattle() && this.chooseAction.has(this.controller()) }
  choosingMove(): boolean { return this.inBattle() && this.chooseMove.has(this.controller()) }
  isTrainer(): boolean { return (this.mem.u32(this.sym('gBattleTypeFlags')) & BATTLE_TYPE_TRAINER) !== 0 }
  outcome(): number { return this.mem.u8(this.sym('gBattleOutcome')) }
  actionCursor(): number { return this.mem.u8(this.sym('gActionSelectionCursor')) }
  moveCursor(): number { return this.mem.u8(this.sym('gMoveSelectionCursor')) }

  private romText(symbol: string, index: number, size: number): string {
    const at = this.sym(symbol) - 0x08000000 + index * size
    return decodeText(this.rom.subarray(at, at + size))
  }

  moveName(id: number): string { return this.romText('gMoveNames', id, MOVE_NAME) }
  speciesName(id: number): string { return this.romText('gSpeciesNames', id, SPECIES_NAME) }
  typeName(id: number): string { return this.romText('gTypeNames', id, TYPE_NAME) }

  mon(battler: number): BattleMon {
    const m = this.mem, b = this.sym('gBattleMons') + battler * BMON
    const species = m.u16(b + SPECIES)
    const types = [...new Set([m.u8(b + TYPE1), m.u8(b + TYPE2)])].map(t => this.romText('gTypeNames', t, TYPE_NAME))
    const moves: BattleMon['moves'] = []
    for (let slot = 0; slot < 4; slot++) {
      const id = m.u16(b + MOVES + 2 * slot)
      if (!id) continue
      const d = this.sym('gBattleMoves') - 0x08000000 + id * MOVE_DATA
      moves.push({
        slot, id, name: this.romText('gMoveNames', id, MOVE_NAME),
        power: this.rom[d + 1]!, type: this.romText('gTypeNames', this.rom[d + 2]!, TYPE_NAME), typeId: this.rom[d + 2]!, accuracy: this.rom[d + 3]!,
        pp: m.u8(b + PP + slot), maxPp: this.rom[d + 4]!,
      })
    }
    return { species, name: this.romText('gSpeciesNames', species, SPECIES_NAME), level: m.u8(b + LEVEL), hp: m.u16(b + HP), maxHp: m.u16(b + MAXHP), types, moves }
  }
}

export const actionId = (moveName: string) => moveName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'm$1') || 'move'

/** The lead Pokémon as an agent: one action per known move (≤4). */
export function battleSpec(me: BattleMon): AgentSpec {
  const usable = me.moves.filter(m => m.pp > 0)
  const moves = usable.length ? usable : me.moves.slice(0, 1)
  return {
    id: 'lead', name: me.name,
    persona: [
      STARTERS[me.species]?.persona ?? '',
      'Your HP is a byte budget. Each of your moves is a script: a damaging script\'s output lands in the foe\'s context, and every byte it absorbs costs it HP. The foe does the same to you. Run the foe out of bytes.',
    ].filter(Boolean).join(' '),
    actions: moves.map(m => {
      const script = scriptFor(m.name, m.power > 0)
      return {
        id: actionId(m.name),
        description: `Run ${script.file} (${m.name}): ${m.type}${m.power ? `, power ${m.power}` : ', status script, no bytes land'}${m.accuracy ? `, accuracy ${m.accuracy}` : ''}, PP ${m.pp}/${m.maxPp}. Source:\n${script.source}`,
      }
    }),
  }
}

export function observe(me: BattleMon, foe: BattleMon, trainer: boolean, incoming: string | null = null): string {
  return [
    `${trainer ? 'Trainer' : 'Wild'} battle. Foe: ${foe.name} Lv${foe.level}, bytes left ${foe.hp}/${foe.maxHp}, type ${foe.types.join('/')}.`,
    `You: ${me.name} Lv${me.level}, bytes left ${me.hp}/${me.maxHp}, type ${me.types.join('/')}.`,
    ...(incoming ? [`Last output that landed in your context: ${incoming}`] : []),
  ].join('\n')
}

/** Baseline brain (CI/offline): best expected damage, ignoring type matchups. */
export function greedyPolicy(moves: BattleMon['moves']) {
  return (request: DecideRequest): Decision => {
    let best = request.spec.actions[0]!.id, score = -1
    for (const a of request.spec.actions) {
      const m = moves.find(x => actionId(x.name) === a.id)
      const s = m ? m.power * (m.accuracy || 100) / 100 + 0.01 : 0
      if (s > score) { score = s; best = a.id }
    }
    return { action: best, args: {}, thought: `${best.toUpperCase().replace(/_/g, ' ')} hits hardest.` }
  }
}
