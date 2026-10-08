// Show what Workers AI's OpenAI-compatible stream sends for tokens that look like JSON (0, [], {}, null, true).
//   CLOUDFLARE_API_KEY=… CLOUDFLARE_ACCOUNT_ID=… node kernel/scripts/stream-probe.mjs
const model = process.argv[2] ?? '@cf/meta/llama-3.2-3b-instruct'
const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/v1/chat/completions`, {
  method: 'POST', headers: { authorization: `Bearer ${process.env.CLOUDFLARE_API_KEY}`, 'content-type': 'application/json' },
  body: JSON.stringify({ model, stream: true, temperature: 0, max_tokens: 60, messages: [{ role: 'user', content: 'Repeat exactly, nothing else: let a = [0, 12, null, {}, [], true]; return null' }] }),
})
const text = await r.text()
const kinds = []
for (const line of text.split('\n')) {
  if (!line.startsWith('data: {')) continue
  for (const c of JSON.parse(line.slice(6)).choices ?? []) if (c.delta && 'content' in c.delta) kinds.push(`${JSON.stringify(c.delta.content)}${c.finish_reason ? '(end)' : ''}${c.delta.role ? '(role)' : ''}`)
}
console.log(model, kinds.join(' '))
