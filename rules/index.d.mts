// Types for the shared battle rules (rules/index.mjs), for the TypeScript player.

export type TypeName = 'NORMAL' | 'FLYING' | 'WATER' | 'GRASS' | 'ROCK' | 'ELECTRIC' | 'GROUND' | 'FIRE' | 'POISON' | 'BUG' | 'PSYCHIC' | 'FIGHTING' | 'STEEL' | 'ICE' | 'GHOST' | 'DRAGON' | 'DARK'
export type Answer = number | string | unknown[] | undefined

export type PayloadKind = 'sound' | 'image'
/** A move that makes bytes (a sound, a picture) instead of answering: check() returns null for a hit or why it missed. */
export interface Payload { kind: PayloadKind; key: string; character?: string; look?: string; palette?: [number, number, number][]; check(value: unknown, bytes: number[]): string | null; ref(bytes: number[]): number[] }
export const PAYLOAD: Record<'growl' | 'trill' | 'whine' | 'lullaby' | 'flash' | 'spark', Payload>
export const PALETTES: Record<'flash' | 'spark' | 'grey', [number, number, number][]>
export const SAMPLE_RATE: number
export const SOUND_MAX: number
export const IMAGE_FRAMES: number
export const IMAGE_PIXELS: number
export const HOW: Record<PayloadKind, string>
export function payloadBytes(p: Payload, value: number[]): number[]
export function soundFeatures(samples: number[], win?: number): { hz: number; rms: number }[]
export function pitchSlope(samples: number[]): number
export function pitchJumps(samples: number[]): number
export function notes(samples: number[]): number
export function fades(samples: number[]): boolean
export interface Voice { m: number; d: number; w: number; s: number; motif: number[]; k: number; g: number; j: number; gw: number }
export function voiceOf(name?: string): Voice
export function voicedRef(p: Payload, name: string): (bytes: number[]) => number[]
export function exampleBody(p: Payload, name?: string): string
export function clampTo(v: number[], hi: number): number[]
export interface Move {
  firered: string; name: string; fn: string; spec: string; shape: 'a number' | 'a list' | 'text' | 'no key' | 'null'
  ref(bytes: number[]): Answer
  type: string; power: string; acc: string; effect: string; starter: boolean; kept: boolean
  payload?: Payload
}
export const MOVES: Move[]
export const byName: Record<string, Move>
export function byFireRed(romName: string): Move | undefined
export function fnName(name: string): string
export const STARTER_MOVES: Set<string>
export const FIRERED: Record<string, [string, string, string, string]>
export const FAMILIES: Record<string, string>
/** The summary screen's words for a move whose spec is too long for four lines of 20 (Code Red name → text). */
export const BRIEF: Record<string, string>

export interface Format { short: string; note: string; encode(bytes: number[]): unknown; decode(data: unknown): number[] }
export const FORMATS: Record<TypeName, Format>
export const HINTS: Record<TypeName, string>
export const EXAMPLE_BYTES: number[]
export function example(type: TypeName): unknown
export function show(value: unknown): string

export interface Growth {
  startTemp: number; tempPerLevel: number; minTemp: number
  budgetBase: number; budgetPerLevel: number; evolutionBudget: number
}
export type Badge = 'BOULDER' | 'CASCADE'
export const GROWTH: Growth
export const BADGES: Record<Badge, { budget?: number }>
export const WORDS: { data: string; v: string }
export const NOTCH: { cap: number; temp: number; budget: number }
export function notchOf(stageSum: number): number
export function focusAt(level: number, p?: Growth, notch?: number): number
export function budgetAt(level: number, opts?: { stage?: number; badges?: string[]; notch?: number }, p?: Growth): number
export function tokenCapFor(budget: number): number

export type Readers = Partial<Record<TypeName, string>>
export interface Know { from: 'dex' | 'memory'; line: string }
export interface RunResult { ok: boolean; value?: unknown; error?: string }
export type RunSource = (source: string) => Promise<RunResult>
export type MissReason = 'no code' | 'over budget' | 'crashed' | 'wrong answer'
export interface Verdict { hit: boolean; reason?: MissReason; error?: string; got?: string; want?: string; payload?: { kind: PayloadKind; bytes: number[]; palette?: [number, number, number][] } }

export const WORKED: number[]
export function rng(seed: number): () => number
export function targetBytes(r: () => number): number[]
export function turnType(r: () => number, types: TypeName[]): TypeName
export function knowFor(type: TypeName, opts?: { dex?: string[]; readers?: Readers }): Know | null
export function turnPrompt(args: {
  self: { name: string; level: number; wild?: boolean }
  target: { name: string; level: number; types: string[] }
  move: Move; type: TypeName; know?: Know | null; budget: number; tutorial?: boolean; words?: { data: string; v: string }; hot?: string
  memory?: { lib?: Helper[]; work?: Helper[]; last?: LastTurn | null } | null
}): { system: string; user: string }
export function contextCost(ctx?: { know?: Know | null; hot?: string; memory?: string }): number
export function codeBudget(budget: number, ctx?: { know?: Know | null; hot?: string; memory?: string }): number
export function turnData(bytes: number[], type: TypeName, tutorial?: boolean): unknown
export function definedName(code: string, fn: string): string
export function answerSource(code: string, move: Move, data: unknown, prelude?: string): string
export function precheck(code: string | null | undefined, budget: number): Verdict | null
export function verdict(move: Move, bytes: number[], run: RunResult): Verdict
export function judge(args: { move: Move; bytes: number[]; data: unknown; code: string | null; budget: number; runSource: RunSource; prelude?: string }): Promise<Verdict>
export function missText(name: string, reason: MissReason | string): string
export function same(a: unknown, b: unknown): boolean
export function extractCode(reply: string | null | undefined): { code: string | null; reason: string | null }
export function formatOf(romType: string): TypeName
export function stageOf(species: string): number

// ---- doubt (rules/doubt.mjs)
export const DOUBT: { maxFriendship: number; cap: number }
export interface InstinctMove { id?: number; name?: string; power: number; accuracy?: number; type: string }
export interface InstinctCtx { selfTypes?: string[]; effectiveness?: (moveType: string) => number }
export function instinctScore(move: InstinctMove | null | undefined, ctx?: InstinctCtx): number
export function instinct<M extends InstinctMove>(moves: M[], ctx?: InstinctCtx): M | null
export function misalignment(friendship: number): number
export function maxDoubt(friendship: number): number
export function doubtChance<M extends InstinctMove>(o: { chosen: M | null | undefined; moves: M[]; friendship?: number; selfTypes?: string[]; effectiveness?: (moveType: string) => number }): { chance: number; wanted: M | null }
export function typeChart(rom: Uint8Array, at: number): (moveType: number, defTypes: number[]) => number

// memory.mjs — a Pokémon's memory is code (2026-10-11)
export interface Helper { name: string; src: string }
export const MEMORY: { capBase: number; capPerLevel: number; workShare: number; workMin: number }
export function libCap(level: number): number
export function workCap(budget: number): number
export function extractHelpers(code: string | null | undefined): Helper[]
export function mergeHelpers(old: Helper[], more: Helper[]): Helper[]
export function helpersSource(helpers: Helper[]): string
export function helpersSize(helpers: Helper[]): number
export function fitHelpers(helpers: Helper[], cap: number): Helper[]
export function helpersFromReaders(readers: Readers | undefined): Helper[]
export function readerType(name: string): TypeName | null
export function recall(helpers: Helper[], type: string): Helper[]
export function checkSource(helpers: Helper[], turn?: { type: string; data: unknown; bytes: number[] } | null): string
export function consolidatePrompt(args: { self: { name: string; level: number }; lib: Helper[]; work: Helper[]; cap: number; stats?: Record<string, { used: number; hits: number }> }): { system: string; user: string }
export interface LastTurn { move: string; type: string; verdict: string; reason?: string; got?: string; want?: string; error?: string }
export function lastTurnLine(last: LastTurn | null | undefined): string
export function memoryLines(args: { lib?: Helper[]; work?: Helper[]; type?: string; last?: LastTurn | null }): string[]
export function withoutCarried(code: string | null, carried: Helper[]): string | null

// knobs.mjs — every tunable number (CUSTOMIZING.md)
export const PAYLOAD_LIMITS: { sampleRate: number; soundMax: number; imageFrames: number }
export const TARGET: { minCount: number; maxCount: number; low: number; high: number }

// ---------- the song (rules/song.mjs, prototype 2026-10-12) ----------
export const SONG: { enabled: boolean }
export interface SongOp { op: string; args: (number | string)[] }
export const OPS: Record<string, { type: string; args: number; glyph: string; js: (args: (number | string)[]) => string }>
export const OP_NAMES: string[]
export const EMIT: Record<string, { type: string; key: (r: () => number) => number; want: (key: number) => string; example: { key: number; song: string }; ok: (tape: number[], key: number) => boolean }>
export function parseSong(text: string): { ops: SongOp[]; error?: undefined } | { error: string; ops?: undefined }
export function runSong(ops: SongOp[]): { tape: number[]; error?: undefined } | { error: string; tape?: undefined }
export function glyphs(ops: SongOp[]): string
export function toJavaScript(ops: SongOp[]): string
export function songPrompt(args: { self: { name: string; level: number }; target: { name: string; level: number }; move: Move; key: number; budget: number; hot?: string }): { system: string; user: string }
export function judgeSong(args: { move: Move; text: string | null; key: number; budget: number }): { hit: boolean; reason?: MissReason; error?: string; got?: number[]; want?: string; ops?: SongOp[] }
export function sings(move: Move | undefined): boolean
