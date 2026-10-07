// A Pokémon = one pi-durable conversation.
//   - who it is (species, level, language, memory) lives in the conversation's `code-red.mon` document
//     and is rendered into its system prompt every request; it is saved with the game
//   - a battle = a fresh context (reset); each move = one turn; old battles stay in storage
//   - a move = one JavaScript block, run in pi-codemode against that move's battle functions
// Two ways to hand over the block (an open experiment, see notes/models.md):
//   'tool'  — pi's code-mode convention: the Pokémon calls the `code` tool with the block
//   'block' — the Pokémon replies with a fenced code block, which the game runs
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { Type } from '@earendil-works/pi-ai'
import { createRegistry, defineDoc, defineExtension, defineTool, Harness, MemoryStorage, section } from '@earendil-works/pi-durable'
import { extractCode, renderDeclarations, runBlock } from './code.mjs'


export const ctx = BACKGROUND_CONTEXT

/** The Pokémon's durable self. Saved with the game; travels with the Pokémon. */
export const MonDoc = defineDoc({
  kind: 'code-red.mon',
  version: 1,
  scope: 'conversation',
  history: 'latest',
  fork: 'current',
  initial: () => ({ species: 'MISSINGNO', level: 1, language: 'javascript', memory: [], memoryLimit: 400 }),
})

/** Whole memory entries, oldest first, until the Pokémon's memory limit (a young Pokémon can't remember everything). */
export function fitMemory(entries, limit) {
  const out = []; let n = 0
  for (const e of entries) { if (n + e.length + 1 > limit) continue; out.push(e); n += e.length + 1 }
  return out.join('\n')
}

export function personaText(mon, mode) {
  const memory = fitMemory(mon.memory ?? [], mon.memoryLimit ?? 0)
  return [
    `You are ${mon.species}, a level ${mon.level} Pokémon. You fight by writing ${mon.language === 'javascript' ? 'JavaScript' : mon.language}.`,
    'When your trainer calls a move, you write the code that performs it, then stop.',
    mode === 'tool'
      ? 'Call the `code` tool exactly once with your code. No words.'
      : 'Reply with only one JavaScript code block. No words outside it. Comments inside are fine.',
    'The code is the body of an async function: use await and return; call battle functions with `await tools.<name>(args)`.',
    ...(memory ? ['', 'Your memory (what you have learned so far):', memory] : []),
  ].join('\n')
}

/** What the trainer says for one move. Battle functions are declared here, per move. */
export function moveText({ move, task, tools, budget, foeLine }) {
  return [
    `${foeLine ? foeLine + ' ' : ''}Your trainer says: use ${move}!`,
    `${move}: ${task}`,
    `Byte budget for this move: ${budget} bytes of tool traffic. Wasted calls waste bytes.`,
    '',
    'Battle functions:',
    renderDeclarations({ tools }),
  ].join('\n')
}

// In-battle state is not durable (only saving the game is): the current move's battle functions
// per conversation, and what its block did.
const arena = new Map()

const codeTool = defineTool({
  name: 'code',
  description: 'Perform the move: run your JavaScript (the body of an async function) against the battle functions your trainer listed.',
  parameters: Type.Object({ code: Type.String({ description: 'JavaScript' }) }),
  execute: async ({ code }, api) => {
    const slot = arena.get(api.conversationId)
    if (!slot) return { content: [{ type: 'text', text: 'No move is being used.' }], isError: true, control: { terminate: true } }
    if (slot.code !== null) return { content: [{ type: 'text', text: 'You already moved this turn.' }], isError: true, control: { terminate: true } }
    slot.code = code
    slot.run = await runBlock(code, slot.tools, slot.runOptions)
    const r = slot.run
    const text = r.ok ? `${slot.move} ran: ${r.log.length} calls, ${r.spent} bytes.` : `${slot.move} crashed: ${r.error}`
    return { content: [{ type: 'text', text }], isError: !r.ok, control: { terminate: true } }
  },
})

const Persona = defineExtension({
  name: 'code-red.pokemon',
  sections: [section('pokemon', async (input, context) => {
    const mon = (await input.read.snapshot(MonDoc, input.conversationId, context)) ?? MonDoc.initial()
    return personaText(mon, input.agent.tools.some(t => t.name === 'code') ? 'tool' : 'block')
  }, { tag: false })],
  tools: [codeTool],
})

const lastAssistant = entries => [...entries].reverse().find(e => e.kind === 'pi.assistant')

/**
 * Open the kernel on a storage (MemoryStorage now; the save file later).
 * @param {{ models: import('@earendil-works/pi-ai/models').Models, storage?: any, settings?: any }} options
 */
export async function openKernel({ models, storage = new MemoryStorage(), settings = {} }) {
  const registry = createRegistry()
  registry.install(Persona)
  const harness = await Harness.open(storage, { models, registry, settings: { retry: { maxRetries: 3 }, ...settings } }, ctx)

  /** Wrap a conversation as a Pokémon. */
  const wrap = conv => ({
    id: conv.id,
    conversation: conv,
    state: async () => (await harness.snapshot(MonDoc, conv.id, ctx)) ?? MonDoc.initial(),
    update: async change => conv.commit(async tx => { change(await tx.doc(MonDoc, conv.id)) }, ctx),
    /** A new battle: fresh context; the Pokémon keeps its document (who it is + memory). */
    battle: async () => conv.reset(undefined, ctx),
    /**
     * Use one move. Returns what the Pokémon wrote and what its block did; judging is the game's job.
     * @param {{ move: string, task: string, tools: any[], budget: number, foeLine?: string, mode?: 'tool'|'block', model: {provider: string, modelId: string}, runOptions?: object }} m
     */
    async useMove({ move, task, tools, budget, foeLine = '', mode = 'block', model, runOptions = {} }) {
      await conv.configure({ model, tools: mode === 'tool' ? [codeTool] : [] }, ctx)
      const slot = { move, tools, runOptions, code: null, run: null }
      arena.set(conv.id, slot)
      const t0 = Date.now()
      try {
        const sub = await conv.submit({ type: 'input', content: moveText({ move, task, tools, budget, foeLine }) }, ctx)
        const settled = await sub.wait(ctx)
        const view = await conv.viewState(ctx)
        const reply = lastAssistant(view.value.entries)
        const message = reply?.model?.at(-1)
        const text = (message?.content ?? []).filter(c => c.type === 'text').map(c => c.text).join('').trim()
        const base = { move, mode, ms: Date.now() - t0, status: settled.status, reply: text, error: message?.errorMessage ?? null, usage: message?.usage ?? null }
        if (settled.status !== 'done' && !slot.code) return { ...base, code: null, run: null, reason: `model: ${settled.status} ${message?.errorMessage ?? ''}`.trim() }
        if (mode === 'tool') {
          if (slot.code === null) return { ...base, code: null, run: null, reason: /```/.test(text) ? 'wrote a code block instead of calling the code tool' : 'no code tool call' }
          return { ...base, code: slot.code, run: slot.run, reason: slot.run.ok ? null : slot.run.error }
        }
        const { code, reason } = extractCode(text)
        if (code === null) return { ...base, code: null, run: null, reason }
        const run = await runBlock(code, tools, runOptions)
        return { ...base, code, run, reason: run.ok ? null : run.error }
      } finally { arena.delete(conv.id) }
    },
  })

  return {
    harness,
    /** A new Pokémon (its own conversation). */
    async createMon(mon) {
      const conv = await harness.createConversation({ ownership: { kind: 'ownerless' }, init: async (tx, id) => { Object.assign(await tx.doc(MonDoc, id), mon) } }, ctx)
      return wrap(conv)
    },
    wrap,
    close: () => harness.close(ctx),
  }
}
