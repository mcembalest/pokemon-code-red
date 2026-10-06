// Brains: what actually picks an agent's action. See agent.ts.
import { observationKey, type Action, type Brain, type DecideRequest, type Decision, type DecisionRecord } from './agent.ts'

export const AGENT_MODEL = 'claude-sonnet-5-5'

/** Anthropic Messages tool definition for an action. `thought` is always the first, required field. */
export function toolFor(action: Action) {
  const properties: Record<string, unknown> = {
    thought: { type: 'string', description: 'Your in-character thought for this turn, max 12 words. Shown to the player.' },
  }
  for (const [name, p] of Object.entries(action.params ?? {})) {
    properties[name] = { type: p.type, ...(p.description ? { description: p.description } : {}), ...(p.enum ? { enum: p.enum } : {}) }
  }
  return { name: action.id, description: action.description, input_schema: { type: 'object', properties, required: Object.keys(properties) } }
}

export function systemPrompt(request: DecideRequest): string {
  const { spec } = request
  return [
    `You are ${spec.name}, a Pokémon who is also an AI coding agent, in the game Pokémon Code Red.`,
    spec.persona,
    `You know exactly ${spec.actions.length} action${spec.actions.length > 1 ? 's' : ''} (like moves). Each turn, read the situation and call exactly one of them.`,
    'Choose well: your trainer is counting on you. Keep the thought short, in character, and specific to this turn.',
  ].join('\n')
}

export function userPrompt(request: DecideRequest): string {
  const lines: string[] = []
  if (request.history.length) {
    lines.push('Recent turns:')
    for (const t of request.history) lines.push(`- ${t.observation.split('\n')[0]} → ${t.decision.action}${t.result ? ` → ${t.result}` : ''}`)
    lines.push('')
  }
  lines.push('Now:', request.observation.text)
  return lines.join('\n')
}

type LlmCall = (body: Record<string, unknown>, signal?: AbortSignal) => Promise<Record<string, unknown>>

/** Claude Sonnet 5.5 via the worker. Forced tool use = always exactly one action. */
export class CloudBrain implements Brain {
  readonly kind = 'cloud'
  private readonly call: LlmCall
  constructor(call: LlmCall) { this.call = call }

  async decide(request: DecideRequest, signal?: AbortSignal): Promise<Decision> {
    const response = await this.call({
      model: AGENT_MODEL,
      max_tokens: 300,
      system: systemPrompt(request),
      tools: request.spec.actions.map(toolFor),
      tool_choice: { type: 'any' },
      messages: [{ role: 'user', content: userPrompt(request) }],
    }, signal)
    const content = Array.isArray(response.content) ? response.content as { type: string; name?: string; input?: Record<string, unknown> }[] : []
    const use = content.find(c => c.type === 'tool_use')
    if (!use?.name || !use.input) throw new Error('model did not choose an action')
    const { thought, ...args } = use.input
    return { action: use.name, args, thought: typeof thought === 'string' ? thought.slice(0, 120) : '' }
  }
}

/** Deterministic function brain (CI, offline, baselines). */
export class MockBrain implements Brain {
  readonly kind = 'mock'
  private readonly policy: (request: DecideRequest) => Decision
  constructor(policy: (request: DecideRequest) => Decision) { this.policy = policy }
  async decide(request: DecideRequest): Promise<Decision> { return this.policy(request) }
}

/**
 * Replays recorded decisions. Matches by observation key first (same situation →
 * same choice), else in order. Unknown situations go to `miss` (or throw → agent fallback).
 */
export class ReplayBrain implements Brain {
  readonly kind = 'replay'
  private readonly byKey = new Map<string, Decision[]>()
  private readonly ordered: Decision[]
  private next = 0
  private readonly miss?: Brain
  constructor(records: DecisionRecord[], miss?: Brain) {
    for (const r of records) {
      const list = this.byKey.get(r.key) ?? []
      list.push(r.decision)
      this.byKey.set(r.key, list)
    }
    this.ordered = records.map(r => r.decision)
    this.miss = miss
  }
  async decide(request: DecideRequest, signal?: AbortSignal): Promise<Decision> {
    const list = this.byKey.get(observationKey(request.spec.id, request.observation.text))
    if (list?.length) return list.shift()!
    if (this.miss) return this.miss.decide(request, signal)
    if (this.next < this.ordered.length) return this.ordered[this.next++]!
    throw new Error('no recorded decision')
  }
}
