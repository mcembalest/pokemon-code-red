// pi-ai → an OpenAI-compatible route shaped like the Worker's /v1/ai (mock), through the kernel.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createModels } from '@earendil-works/pi-ai/models'
import { BATTLE_MODEL, GAME_PROVIDER, gameApiProvider, openKernel, writeCode } from '../index.mjs'

test('a Pokémon moves through the game API provider (streamed OpenAI chunks, session token)', async () => {
  const seen = []
  const server = createServer((req, res) => {
    let b = ''; req.on('data', c => (b += c)); req.on('end', () => {
      seen.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(b) })
      res.setHeader('content-type', 'text/event-stream')
      const chunk = o => res.write(`data: ${JSON.stringify(o)}\n\n`)
      chunk({ id: 'c', object: 'chat.completion.chunk', model: 'm', choices: [{ index: 0, delta: { role: 'assistant', content: '```js\nawait tools.scratch({ slot: 1 })' } }] })
      chunk({ id: 'c', object: 'chat.completion.chunk', model: 'm', choices: [{ index: 0, delta: { content: '\n```' }, finish_reason: 'stop' }] })
      chunk({ id: 'c', object: 'chat.completion.chunk', model: 'm', choices: [], usage: { prompt_tokens: 50, completion_tokens: 9, total_tokens: 59 } })
      res.end('data: [DONE]\n\n')
    })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const models = createModels()
  models.setProvider(gameApiProvider({ baseUrl: `http://127.0.0.1:${server.address().port}/v1/ai`, token: async () => 'session-123' }))
  const k = await openKernel({ models })
  const mon = await k.createMon({ species: 'CHARMANDER', level: 5 })
  await mon.battle()
  const tools = [{ name: 'scratch', description: 'Scratch one slot.', inputSchema: { type: 'object', properties: { slot: { type: 'integer' } } }, execute: async () => 'ok' }]
  const r = await mon.useMove({ move: 'SCRATCH', task: 't', tools, budget: 300, mode: 'block', model: { provider: GAME_PROVIDER, modelId: '@cf/meta/llama-3.2-3b-instruct' } })
  await k.close(); server.close()
  assert.equal(r.reason, null, JSON.stringify(r))
  assert.deepEqual(r.run.log.map(c => c.args), [{ slot: 1 }])
  assert.equal(seen[0].url, '/v1/ai/chat/completions')
  assert.equal(seen[0].auth, 'Bearer session-123')
  assert.equal(seen[0].body.model, '@cf/meta/llama-3.2-3b-instruct')
  assert.equal(seen[0].body.stream, true)
  assert.match(seen[0].body.messages[0].content, /You are CHARMANDER/)
})

test('writeCode streams a turn through the game API provider', async () => {
  const server = createServer((req, res) => {
    let b = ''; req.on('data', c => (b += c)); req.on('end', () => {
      res.setHeader('content-type', 'text/event-stream')
      const chunk = o => res.write(`data: ${JSON.stringify(o)}\n\n`)
      for (const piece of ['```js\n', 'function slice(data) {\n', '  return data.slice(0, ', '3)\n}\n', '```'])
        chunk({ id: 'c', object: 'chat.completion.chunk', model: 'm', choices: [{ index: 0, delta: { content: piece } }] })
      chunk({ id: 'c', object: 'chat.completion.chunk', model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
      res.end('data: [DONE]\n\n')
    })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const models = createModels()
  models.setProvider(gameApiProvider({ baseUrl: `http://127.0.0.1:${server.address().port}/v1/ai`, token: 'session-1' }))
  const pieces = []
  const { text } = await writeCode({ models, model: { provider: GAME_PROVIDER, modelId: BATTLE_MODEL }, system: 's', user: 'u', temperature: 0.8, onText: d => pieces.push(d) })
  server.close()
  assert.equal(text, '```js\nfunction slice(data) {\n  return data.slice(0, 3)\n}\n```')
  assert.ok(pieces.length >= 3, 'streamed in pieces')
  assert.equal(pieces.join(''), text)
})
