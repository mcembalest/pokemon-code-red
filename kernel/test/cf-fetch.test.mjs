import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gameModels, PROVIDER } from '../index.mjs'

test('Workers AI quirks: numeric stream tokens kept, message content flattened', async () => {
  const sent = []
  const real = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), body: JSON.parse(init.body) })
    const chunks = ['let i = ', 0, '; return i + ', 1.5].map(c => `data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', model: 'm', choices: [{ index: 0, delta: { content: c } }] })}\n\n`)
    return new Response(chunks.join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
  }
  process.env.CLOUDFLARE_API_KEY = 'k'; process.env.CLOUDFLARE_ACCOUNT_ID = 'acct'
  try {
    const models = gameModels()
    const m = models.getModel(PROVIDER, '@cf/meta/llama-3.2-3b-instruct')
    const r = await models.complete(m, { systemPrompt: 'You are CHARMANDER.', messages: [{ role: 'user', content: [{ type: 'text', text: 'use ' }, { type: 'text', text: 'SCRATCH!' }], timestamp: 0 }] })
    assert.equal(r.content.map(c => c.text).join(''), 'let i = 0; return i + 1.5')
    assert.equal(sent[0].url, 'https://api.cloudflare.com/client/v4/accounts/acct/ai/v1/chat/completions')
    assert.ok(sent[0].body.messages.every(msg => typeof msg.content === 'string'), JSON.stringify(sent[0].body.messages))
    assert.equal(sent[0].body.messages.at(-1).content, 'use SCRATCH!')
  } finally { globalThis.fetch = real }
})
