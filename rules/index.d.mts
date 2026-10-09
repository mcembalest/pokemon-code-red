// Types for the shared battle rules (rules/index.mjs), for the TypeScript player.

export type TypeName = 'NORMAL' | 'FLYING' | 'WATER' | 'GRASS' | 'ROCK' | 'ELECTRIC' | 'GROUND' | 'FIRE' | 'POISON' | 'BUG' | 'PSYCHIC' | 'FIGHTING' | 'STEEL' | 'ICE' | 'GHOST' | 'DRAGON' | 'DARK'
export type Answer = number | string | unknown[] | undefined

export interface Move {
  firered: string; name: string; fn: string; spec: string; shape: 'a number' | 'a list' | 'text' | 'no key' | 'null'
  ref(bytes: number[]): Answer
  type: string; power: string; acc: string; effect: string; starter: boolean; kept: boolean
}
export const MOVES: Move[]
export const byName: Record<string, Move>
export function byFireRed(romName: string): Move | undefined
export function fnName(name: string): string
export const STARTER_MOVES: Set<string>
export const FIRERED: Record<string, [string, string, string, string]>
export const FAMILIES: Record<string, string>

export interface Format { note: string; encode(bytes: number[]): unknown; decode(data: unknown): number[] }
export const FORMATS: Record<TypeName, Format>
export const HINTS: Record<TypeName, string>
export const EXAMPLE_BYTES: number[]
export function example(type: TypeName): unknown
export function show(value: unknown): string

export interface Growth {
  startTemp: number; tempPerLevel: number; minTemp: number
  budgetBase: number; budgetPerLevel: number; evolutionBudget: number
  slotsBase: number; levelsPerSlot: number; evolutionSlots: number
}
export type Badge = 'BOULDER' | 'CASCADE'
export const GROWTH: Growth
export const BADGES: Record<Badge, { readers?: TypeName[]; budget?: number }>
export const WORDS: { data: string; v: string }
export const NOTCH: { cap: number; temp: number; budget: number }
export function notchOf(stageSum: number): number
export function focusAt(level: number, p?: Growth, notch?: number): number
export function budgetAt(level: number, opts?: { stage?: number; badges?: string[]; notch?: number }, p?: Growth): number
export function slotsAt(level: number, opts?: { stage?: number }, p?: Growth): number
export function partyDex(opts?: { seen?: string[]; badges?: string[] }): TypeName[]
export const KNOWLEDGE: { wild: number; trainer: number; boss: number }
export const BOSS_CLASSES: Set<number>
export function tierOf(trainerClass: number, wild: boolean): 'wild' | 'trainer' | 'boss'
export function foeDex(tier: 'wild' | 'trainer' | 'boss', personality: number, formats: string[], chance?: number): string[]
export function tokenCapFor(budget: number): number

export type Readers = Partial<Record<TypeName, string>>
export interface Know { from: 'dex' | 'memory'; line: string }
export interface RunResult { ok: boolean; value?: unknown; error?: string }
export type RunSource = (source: string) => Promise<RunResult>
export type MissReason = 'no code' | 'over budget' | 'crashed' | 'wrong answer'
export interface Verdict { hit: boolean; reason?: MissReason; error?: string; got?: string; want?: string }

export const WORKED: number[]
export function rng(seed: number): () => number
export function targetBytes(r: () => number): number[]
export function turnType(r: () => number, types: TypeName[]): TypeName
export function knowFor(type: TypeName, opts?: { dex?: string[]; readers?: Readers }): Know | null
export function turnPrompt(args: {
  self: { name: string; level: number; wild?: boolean }
  target: { name: string; level: number; types: string[] }
  move: Move; type: TypeName; know?: Know | null; budget: number; tutorial?: boolean; words?: { data: string; v: string }; hot?: string
}): { system: string; user: string }
export function contextCost(ctx?: { know?: Know | null; hot?: string }): number
export function codeBudget(budget: number, ctx?: { know?: Know | null; hot?: string }): number
export function turnData(bytes: number[], type: TypeName, tutorial?: boolean): unknown
export function definedName(code: string, fn: string): string
export function answerSource(code: string, move: Move, data: unknown): string
export function precheck(code: string | null | undefined, budget: number): Verdict | null
export function verdict(move: Move, bytes: number[], run: RunResult): Verdict
export function judge(args: { move: Move; bytes: number[]; data: unknown; code: string | null; budget: number; runSource: RunSource }): Promise<Verdict>
export function missText(name: string, reason: MissReason | string): string
export function readerLine(code: string | null | undefined): string | null
export function readerSource(line: string, data: unknown): string
export function readsRight(run: RunResult, bytes: number[]): boolean
export function learn(readers: Readers, type: TypeName, line: string, slots?: number): Readers
export function learnFromHit(args: { readers: Readers; type: TypeName; code: string | null; data: unknown; bytes: number[]; slots?: number; dex?: string[]; runSource: RunSource }): Promise<Readers>
export function same(a: unknown, b: unknown): boolean
export function extractCode(reply: string | null | undefined): { code: string | null; reason: string | null }
export function formatOf(romType: string): TypeName
export function stageOf(species: string): number
