// Every Pokémon the player owns: the party (gPlayerParty) and the PC boxes (gPokemonStoragePtr),
// read straight from RAM for the PokÉEG. Box Pokémon keep their species and experience in encrypted
// substructs (include/pokemon.h): each u32 word is xored with personality ^ otId, and the four 12-byte
// substructs (Growth, Attacks, EVs, Misc) are ordered by personality % 24.
import { decodeText, type BattleMemory, type Symbols } from './battle.ts'

const BOX_MON = 80, PARTY_MON = 100, PARTY_LEVEL = 0x54
const BOXES = 14, IN_BOX = 30
const NICKNAME = 8, NICKNAME_LEN = 10, FLAGS = 19, SECURE = 32
const SPECIES_INFO = 28, SI_TYPE1 = 6, SI_TYPE2 = 7, SI_GROWTH = 0x13
const LEVELS = 101, SPECIES_NAME = 11, TYPE_NAME = 7
const ORDER = ['GAEM', 'GAME', 'GEAM', 'GEMA', 'GMAE', 'GMEA', 'AGEM', 'AGME', 'AEGM', 'AEMG', 'AMGE', 'AMEG',
  'EGAM', 'EGMA', 'EAGM', 'EAMG', 'EMGA', 'EMAG', 'MGAE', 'MGEA', 'MAGE', 'MAEG', 'MEGA', 'MEAG']

export interface OwnedMon {
  where: 'party' | 'box'
  box: number; slot: number
  personality: number
  species: number; name: string; nickname: string
  level: number
  types: string[]
}

export class OwnedReader {
  private readonly mem: BattleMemory
  private readonly rom: Uint8Array
  private readonly at: Record<string, number> = {}

  constructor(mem: BattleMemory, rom: Uint8Array, symbols: Symbols) {
    this.mem = mem; this.rom = rom
    for (const n of ['gPlayerParty', 'gPlayerPartyCount', 'gPokemonStoragePtr', 'gSpeciesInfo', 'gExperienceTables', 'gSpeciesNames', 'gTypeNames']) {
      const s = symbols[n]
      if (!s) throw new Error(`rom.json has no ${n}`)
      this.at[n] = s.address
    }
  }

  static supported(symbols: Symbols): boolean {
    return ['gPlayerParty', 'gPokemonStoragePtr', 'gSpeciesInfo', 'gExperienceTables', 'gSpeciesNames', 'gTypeNames'].every(n => n in symbols)
  }

  private romU8(address: number): number { return this.rom[address - 0x08000000] ?? 0 }
  private romU32(address: number): number {
    const i = address - 0x08000000
    return ((this.rom[i]! | this.rom[i + 1]! << 8 | this.rom[i + 2]! << 16) + this.rom[i + 3]! * 0x1000000)
  }
  private romText(symbol: string, index: number, size: number): string {
    const i = this.at[symbol]! - 0x08000000 + index * size
    return decodeText(this.rom.subarray(i, i + size))
  }
  typeName(id: number): string { return this.romText('gTypeNames', id, TYPE_NAME) }
  /** A species' type names (one when both slots match). */
  typesOf(species: number): string[] {
    const t1 = this.romU8(this.at.gSpeciesInfo! + species * SPECIES_INFO + SI_TYPE1), t2 = this.romU8(this.at.gSpeciesInfo! + species * SPECIES_INFO + SI_TYPE2)
    return t1 === t2 ? [this.typeName(t1)] : [this.typeName(t1), this.typeName(t2)]
  }

  /** Level for an experience total under the species' growth rate (the box stores no level). */
  levelFor(species: number, experience: number): number {
    const table = this.at.gExperienceTables! + this.romU8(this.at.gSpeciesInfo! + species * SPECIES_INFO + SI_GROWTH) * LEVELS * 4
    let level = 1
    while (level < 100 && this.romU32(table + (level + 1) * 4) <= experience) level++
    return level
  }

  /** One BoxPokemon at `base`; null when the slot is empty or an egg. */
  private boxMon(base: number, where: 'party' | 'box', box: number, slot: number, partyLevel?: number): OwnedMon | null {
    const m = this.mem
    const personality = m.u32(base) >>> 0
    const flags = m.u8(base + FLAGS)
    if (!(flags & 2) || flags & 1 || flags & 4) return null // no species / bad egg / egg
    const key = (personality ^ m.u32(base + 4)) >>> 0
    const g = ORDER[personality % 24]!.indexOf('G') * 12
    const w0 = (m.u32(base + SECURE + g) ^ key) >>> 0
    const w1 = (m.u32(base + SECURE + g + 4) ^ key) >>> 0
    const species = w0 & 0xFFFF
    if (!species) return null
    const nick = new Uint8Array(NICKNAME_LEN)
    for (let i = 0; i < NICKNAME_LEN; i++) nick[i] = m.u8(base + NICKNAME + i)
    const types = this.typesOf(species)
    return { where, box, slot, personality, species, name: this.romText('gSpeciesNames', species, SPECIES_NAME), nickname: decodeText(nick), level: partyLevel ?? this.levelFor(species, w1), types }
  }

  party(): OwnedMon[] {
    const out: OwnedMon[] = []
    const count = Math.min(this.mem.u8(this.at.gPlayerPartyCount!), 6)
    for (let i = 0; i < count; i++) {
      const base = this.at.gPlayerParty! + i * PARTY_MON
      const mon = this.boxMon(base, 'party', -1, i, this.mem.u8(base + PARTY_LEVEL))
      if (mon) out.push(mon)
    }
    return out
  }

  boxes(): OwnedMon[] {
    const ptr = this.mem.u32(this.at.gPokemonStoragePtr!) >>> 0
    if (ptr < 0x02000000 || ptr >= 0x02040000) return [] // not set up yet (title screen)
    const out: OwnedMon[] = []
    for (let b = 0; b < BOXES; b++) for (let s = 0; s < IN_BOX; s++) {
      const mon = this.boxMon(ptr + 1 + (b * IN_BOX + s) * BOX_MON, 'box', b, s)
      if (mon) out.push(mon)
    }
    return out
  }

  /** Party first, then the boxes in order. */
  all(): OwnedMon[] { return [...this.party(), ...this.boxes()] }
}
