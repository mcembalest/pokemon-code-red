import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gameModels, PROVIDER } from '../index.mjs'

test('Workers AI quirks: numeric stream tokens kept, message content flattened', async () => {
  const sent = []
  const real = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), body: JSON.parse(init.body) })
    const chunks = ['let i = ', 0, '; const { b = ', [], ' } = f; return i + ', 1.5, ' || ', null, ' || ', {}, ' || ', true].map(c => `data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', model: 'm', choices: [{ index: 0, delta: { content: c } }] })}\n\n`)
    return new Response(chunks.join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
  }
  process.env.CLOUDFLARE_API_KEY = 'k'; process.env.CLOUDFLARE_ACCOUNT_ID = 'acct'
  try {
    const models = gameModels()
    const m = models.getModel(PROVIDER, '@cf/meta/llama-3.2-3b-instruct')
    const r = await models.complete(m, { systemPrompt: 'You are CHARMANDER.', messages: [{ role: 'user', content: [{ type: 'text', text: 'use ' }, { type: 'text', text: 'SCRATCH!' }], timestamp: 0 }] })
    assert.equal(r.content.map(c => c.text).join(''), 'let i = 0; const { b = [] } = f; return i + 1.5 || null || {} || true')
    assert.equal(sent[0].url, 'https://api.cloudflare.com/client/v4/accounts/acct/ai/v1/chat/completions')
    assert.ok(sent[0].body.messages.every(msg => typeof msg.content === 'string'), JSON.stringify(sent[0].body.messages))
    assert.equal(sent[0].body.messages.at(-1).content, 'use SCRATCH!')
  } finally { globalThis.fetch = real }
})

// Dress rehearsal 2026-10-10: on the live site ERROR's code arrived with every number gone (`let p=;for(let i=;…`).
// The game route's stream came back labelled application/json, so the fixer stepped aside and pi-ai dropped the
// numeric tokens. Any stream we asked for gets fixed, whatever its content-type says.
for (const type of ['application/json', '', 'text/event-stream; charset=utf-8']) {
  test(`game route: numeric tokens survive a stream labelled ${JSON.stringify(type)}`, async () => {
    const { gameApiProvider, GAME_PROVIDER, writeCode, PAYLOAD_MODEL } = await import('../index.mjs')
    const real = globalThis.fetch
    globalThis.fetch = async () => {
      const chunks = ['let p=', 0, ';for(let i=', 0, ';i<', 3199, ';i++)'].map(c => `data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', model: 'm', choices: [{ index: 0, delta: { content: c } }] })}\n\n`)
      const end = `data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`
      return new Response(chunks.join('') + end + 'data: [DONE]\n\n', { headers: type ? { 'content-type': type } : {} })
    }
    try {
      const models = gameModels(gameApiProvider({ baseUrl: 'https://api.example/v1/ai', token: 't', modelIds: [PAYLOAD_MODEL] }))
      const { text } = await writeCode({ models, model: { provider: GAME_PROVIDER, modelId: PAYLOAD_MODEL }, system: 's', user: 'u', temperature: 0.2 })
      assert.equal(text, 'let p=0;for(let i=0;i<3199;i++)')
    } finally { globalThis.fetch = real }
  })
}
