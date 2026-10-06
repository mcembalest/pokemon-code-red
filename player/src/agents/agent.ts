// Agent framework v0. A Pokémon is a coding agent with at most 4 actions
// (like 4 moves). Each turn it observes, then picks exactly one action.
// The "brain" behind the choice is swappable:
//   cloud   — Claude Sonnet 5.5 through the worker (/v1/llm), tool use
//   replay  — recorded decisions (deterministic; tests, simulator, bug reports)
//   mock    — a plain function (CI, offline)
//   local   — (planned) small open model in the browser; same interface
// Decisions are validated against the agent's actions; anything invalid
// falls back to a safe action instead of breaking the game.

export const MAX_ACTIONS = 4

export interface Param {
  type: 'string' | 'integer' | 'boolean'
  description?: string
  enum?: (string | number)[]
}

export interface Action {
  id: string                       // tool name: [a-z][a-z0-9_]{0,31}
  description: string
  params?: Record<string, Param>   // all required
}

export interface AgentSpec {
  id: string
  name: string                     // in-game name, e.g. "CHARMANDER"
  persona: string                  // one or two sentences
  actions: Action[]                // 1..4
}

export interface Observation { text: string; data?: unknown }

export interface Decision {
  action: string
  args: Record<string, unknown>
  thought: string
}

export interface Turn { observation: string; decision: Decision; result?: string }

export interface DecideRequest { spec: AgentSpec; observation: Observation; history: Turn[] }

export interface Brain {
  readonly kind: string
  decide(request: DecideRequest, signal?: AbortSignal): Promise<Decision>
}

export interface DecisionRecord {
  agent: string; key: string; observation: string
  decision: Decision; brain: string; ms: number; fallback?: string
}

const ACTION_ID = /^[a-z][a-z0-9_]{0,31}$/

export function checkSpec(spec: AgentSpec): void {
  if (spec.actions.length < 1 || spec.actions.length > MAX_ACTIONS) throw new Error(`${spec.name} must have 1-${MAX_ACTIONS} actions, has ${spec.actions.length}`)
  const ids = new Set<string>()
  for (const a of spec.actions) {
    if (!ACTION_ID.test(a.id)) throw new Error(`bad action id ${a.id}`)
    if (ids.has(a.id)) throw new Error(`duplicate action ${a.id}`)
    if (a.params && 'thought' in a.params) throw new Error('"thought" is reserved')
    ids.add(a.id)
  }
}

/** Returns an error string, or null if the decision is valid for this spec. */
export function validate(spec: AgentSpec, d: Decision): string | null {
  const action = spec.actions.find(a => a.id === d.action)
  if (!action) return `unknown action ${JSON.stringify(d.action)}`
  for (const [name, p] of Object.entries(action.params ?? {})) {
    const v = d.args[name]
    if (v === undefined) return `missing ${name}`
    if (p.type === 'integer' ? !Number.isInteger(v) : typeof v !== p.type) return `${name} must be ${p.type}`
    if (p.enum && !p.enum.includes(v as string | number)) return `${name} must be one of ${p.enum.join(', ')}`
  }
  for (const name of Object.keys(d.args)) if (!(name in (action.params ?? {}))) return `unexpected ${name}`
  return null
}

/** Stable key for an observation (FNV-1a, hex). Used to match recorded decisions. */
export function observationKey(agentId: string, text: string): string {
  let h = 0x811c9dc5
  const s = agentId + '\u0000' + text
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export class Agent {
  spec: AgentSpec
  readonly history: Turn[] = []
  readonly records: DecisionRecord[] = []
  private readonly brain: Brain
  private readonly fallback: (spec: AgentSpec, observation: Observation) => Decision
  private readonly historyLimit: number

  constructor(spec: AgentSpec, brain: Brain, options: { fallback?: (spec: AgentSpec, observation: Observation) => Decision; historyLimit?: number } = {}) {
    checkSpec(spec)
    this.spec = spec
    this.brain = brain
    this.fallback = options.fallback ?? (s => ({ action: s.actions[0]!.id, args: defaultArgs(s.actions[0]!), thought: '…' }))
    this.historyLimit = options.historyLimit ?? 6
  }

  /** Actions can change between turns (e.g. a move was learned or ran out of PP). */
  setSpec(spec: AgentSpec): void { checkSpec(spec); this.spec = spec }

  get brainKind(): string { return this.brain.kind }

  /** One turn: ask the brain, validate, fall back if needed. Never throws (except on abort). */
  async turn(observation: Observation, signal?: AbortSignal): Promise<{ decision: Decision; record: DecisionRecord }> {
    const t0 = Date.now()
    const request = { spec: this.spec, observation, history: this.history.slice(-this.historyLimit) }
    let decision: Decision | null = null, problem: string | undefined
    try {
      const d = await this.brain.decide(request, signal)
      const err = validate(this.spec, d)
      if (err) problem = 'invalid: ' + err; else decision = d
    } catch (e) {
      if (signal?.aborted) throw e
      problem = e instanceof Error ? e.message : String(e)
    }
    if (!decision) decision = this.fallback(this.spec, observation)
    const record: DecisionRecord = {
      agent: this.spec.id, key: observationKey(this.spec.id, observation.text), observation: observation.text,
      decision, brain: this.brain.kind, ms: Date.now() - t0, ...(problem ? { fallback: problem } : {}),
    }
    this.records.push(record)
    this.history.push({ observation: observation.text, decision })
    return { decision, record }
  }

  /** Attach the outcome of the last action (shown to the brain next turn). */
  noteResult(result: string): void {
    const last = this.history.at(-1)
    if (last) last.result = result
  }
}

function defaultArgs(action: Action): Record<string, unknown> {
  const args: Record<string, unknown> = {}
  for (const [name, p] of Object.entries(action.params ?? {})) args[name] = p.enum?.[0] ?? (p.type === 'string' ? '' : p.type === 'integer' ? 0 : false)
  return args
}
