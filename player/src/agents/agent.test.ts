import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Agent, checkSpec, observationKey, validate, type AgentSpec, type Decision } from './agent.ts'
import { CloudBrain, MockBrain, ReplayBrain, toolFor, userPrompt } from './brains.ts'

const SPEC: AgentSpec = {
  id: 'starter', name: 'CHARMANDER', persona: 'Hot-headed but careful with errors.',
  actions: [
    { id: 'use_move', description: 'Use one of your battle moves.', params: { slot: { type: 'integer', enum: [0, 1] } } },
    { id: 'think', description: 'Do nothing this turn.' },
  ],
}

test('spec: 1-4 unique, well-formed actions; thought is reserved', () => {
  checkSpec(SPEC)
  const five = { ...SPEC, actions: ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, description: id })) }
  assert.throws(() => checkSpec(five), /1-4 actions/)
  assert.throws(() => checkSpec({ ...SPEC, actions: [] }), /1-4 actions/)
  assert.throws(() => checkSpec({ ...SPEC, actions: [{ id: 'Bad-Id', description: '' }] }), /bad action id/)
  assert.throws(() => checkSpec({ ...SPEC, actions: [{ id: 'a', description: '' }, { id: 'a', description: '' }] }), /duplicate/)
  assert.throws(() => checkSpec({ ...SPEC, actions: [{ id: 'a', description: '', params: { thought: { type: 'string' } } }] }), /reserved/)
})

test('validate: action, param types, enums, extras', () => {
  assert.equal(validate(SPEC, { action: 'use_move', args: { slot: 1 }, thought: '' }), null)
  assert.match(validate(SPEC, { action: 'hack', args: {}, thought: '' })!, /unknown action/)
  assert.match(validate(SPEC, { action: 'use_move', args: {}, thought: '' })!, /missing slot/)
  assert.match(validate(SPEC, { action: 'use_move', args: { slot: '1' }, thought: '' })!, /integer/)
  assert.match(validate(SPEC, { action: 'use_move', args: { slot: 3 }, thought: '' })!, /one of/)
  assert.match(validate(SPEC, { action: 'think', args: { x: 1 }, thought: '' })!, /unexpected/)
})

test('agent: records turns; invalid or failing brains fall back without throwing', async () => {
  const bad = new MockBrain(() => ({ action: 'use_move', args: { slot: 9 }, thought: 'x' }))
  const agent = new Agent(SPEC, bad)
  const { decision, record } = await agent.turn({ text: 'Foe: SQUIRTLE' })
  assert.deepEqual(decision, { action: 'use_move', args: { slot: 0 }, thought: '…' })
  assert.match(record.fallback!, /invalid/)
  const broken = new Agent(SPEC, new MockBrain(() => { throw new Error('offline') }))
  assert.equal((await broken.turn({ text: 'x' })).record.fallback, 'offline')
  const good = new Agent(SPEC, new MockBrain(r => ({ action: 'use_move', args: { slot: r.history.length % 2 }, thought: 'go' })))
  await good.turn({ text: 't1' }); good.noteResult('hit'); await good.turn({ text: 't2' })
  assert.deepEqual(good.history.map(t => t.decision.args.slot), [0, 1])
  assert.equal(good.history[0]!.result, 'hit')
  assert.equal(good.records.length, 2)
})

test('replay: same observation → same decision; reproduces a recorded run', async () => {
  let n = 0
  const live = new Agent(SPEC, new MockBrain(() => ({ action: 'use_move', args: { slot: n++ % 2 }, thought: `t${n}` })))
  for (const text of ['a', 'b', 'a']) await live.turn({ text })
  const replayed = new Agent(SPEC, new ReplayBrain(live.records))
  const out: Decision[] = []
  for (const text of ['a', 'b', 'a']) out.push((await replayed.turn({ text })).decision)
  assert.deepEqual(out, live.records.map(r => r.decision))
  assert.equal(observationKey('starter', 'a'), live.records[0]!.key)
  const exhausted = new Agent(SPEC, new ReplayBrain([]))
  assert.match((await exhausted.turn({ text: 'z' })).record.fallback!, /no recorded/)
})

test('cloud: forced tool use with thought; parses the tool call', async () => {
  let sent: Record<string, any> = {}
  const brain = new CloudBrain(async body => {
    sent = body
    return { content: [{ type: 'tool_use', name: 'use_move', input: { thought: 'Ember would be nice. Scratch it is.', slot: 1 } }] }
  })
  const agent = new Agent(SPEC, brain)
  agent.history.push({ observation: 'Foe: SQUIRTLE 19/19\nmore', decision: { action: 'use_move', args: { slot: 0 }, thought: '' }, result: 'SQUIRTLE 15/19' })
  const { decision } = await agent.turn({ text: 'Foe: SQUIRTLE 15/19' })
  assert.deepEqual(decision, { action: 'use_move', args: { slot: 1 }, thought: 'Ember would be nice. Scratch it is.' })
  assert.equal(sent.model, 'claude-sonnet-5-5')
  assert.deepEqual(sent.tool_choice, { type: 'any' })
  assert.deepEqual(sent.tools[0], toolFor(SPEC.actions[0]!))
  assert.deepEqual(sent.tools[0].input_schema.required, ['thought', 'slot'])
  assert.match(sent.messages[0].content, /Recent turns:\n- Foe: SQUIRTLE 19\/19 → use_move → SQUIRTLE 15\/19/)
  assert.match(sent.system, /CHARMANDER/)
  assert.match(userPrompt({ spec: SPEC, observation: { text: 'x' }, history: [] }), /^Now:\nx$/)
})
