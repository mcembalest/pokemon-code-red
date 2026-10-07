import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai'
import { gameModels, openKernel, extractCode, normalizeBlock, fitMemory, EXTRA_MODELS, PROVIDER } from '../index.mjs'

const tools = foe => [
  { name: 'scan', description: 'Read the foe.', inputSchema: { type: 'object', properties: {} }, execute: async () => ({ bytes: foe }) },
  { name: 'scratch', description: 'Scratch one slot.', inputSchema: { type: 'object', properties: { slot: { type: 'integer' } }, required: ['slot'] }, execute: async () => 'ok' },
]

test('workers AI provider has pi catalog + our small models', () => {
  const models = gameModels()
  for (const m of EXTRA_MODELS) assert.ok(models.getModel(PROVIDER, m.id), m.id)
  assert.ok(models.getModel(PROVIDER, '@cf/ibm-granite/granite-4.0-h-micro'))
})

test('code helpers', () => {
  assert.equal(extractCode('```js\nreturn 1\n```').code, 'return 1')
  assert.equal(extractCode('Sure!\n```js\nreturn 1\n```').code, null)
  assert.match(normalizeBlock('async function go() { return 1 }'), /return await go\(\)$/)
  assert.equal(fitMemory(['aaaa', 'bbbbbbbbbb', 'cc'], 8), 'aaaa\ncc')
})

test('a Pokémon is a durable conversation; moves run as code blocks or code-tool calls', async () => {
  const faux = fauxProvider()
  const k = await openKernel({ models: gameModels(faux.provider) })
  const model = { provider: faux.provider.id, modelId: faux.getModel().id }
  const mon = await k.createMon({ species: 'CHARMANDER', level: 5, memory: ['- scan first'], memoryLimit: 100 })
  assert.equal((await mon.state()).species, 'CHARMANDER')
  await mon.battle()

  faux.setResponses([fauxAssistantMessage('```js\nconst f = await tools.scan()\nawait tools.scratch({ slot: 1 })\n```')])
  const block = await mon.useMove({ move: 'SCRATCH', task: 't', tools: tools([5, 3]), budget: 300, mode: 'block', model })
  assert.equal(block.reason, null)
  assert.deepEqual(block.run.log.map(c => c.name), ['scan', 'scratch'])
  assert.equal(block.run.spent, 2 + 15 + 10 + 4)

  faux.setResponses([fauxAssistantMessage([fauxToolCall('code', { code: 'await tools.scratch({ slot: 0 })' })], { stopReason: 'toolUse' })])
  const tool = await mon.useMove({ move: 'SCRATCH', task: 't', tools: tools([5, 3]), budget: 300, mode: 'tool', model })
  assert.equal(tool.reason, null)
  assert.deepEqual(tool.run.log.map(c => c.args), [{ slot: 0 }])

  faux.setResponses([fauxAssistantMessage('```js\nawait tools.scratch({ slot: 0 })\n```')])
  const noCall = await mon.useMove({ move: 'SCRATCH', task: 't', tools: tools([5, 3]), budget: 300, mode: 'tool', model })
  assert.equal(noCall.reason, 'wrote a code block instead of calling the code tool')

  faux.setResponses([fauxAssistantMessage('```js\nthrow new Error("distracted")\n```')])
  const crash = await mon.useMove({ move: 'SCRATCH', task: 't', tools: tools([5, 3]), budget: 300, mode: 'block', model })
  assert.match(crash.reason, /^script: .*distracted/)

  await mon.update(m => { m.level = 6; m.memory.push('- new note') })
  assert.equal((await mon.state()).level, 6)
  await k.close()
})
