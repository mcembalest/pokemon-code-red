// Workers AI's OpenAI-compatible endpoint has two quirks that break pi-ai (found in run 3):
//  1. streamed numeric tokens arrive as JSON numbers (`"content": 0`) and pi-ai drops them,
//     so code loses its digits (`let i = ;`)
//  2. some models reject message `content` as an array of parts, or `null` next to tool calls
// This fetch fixes both on the way in and out. Used by every provider in models.mjs.

const textOf = content => Array.isArray(content) ? content.map(p => (typeof p === 'string' ? p : p?.text ?? '')).join('') : content

function fixRequest(init) {
  if (typeof init?.body !== 'string') return init
  let body
  try { body = JSON.parse(init.body) } catch { return init }
  if (!Array.isArray(body.messages)) return init
  body.messages = body.messages.map(m => ({ ...m, content: textOf(m.content) ?? '' }))
  return { ...init, body: JSON.stringify(body) }
}

function fixChunk(line) {
  if (!line.startsWith('data:')) return line
  const data = line.slice(5).trim()
  if (!data.startsWith('{')) return line
  try {
    const chunk = JSON.parse(data)
    let changed = false
    for (const c of chunk.choices ?? []) {
      if (c.delta && c.delta.content !== undefined && c.delta.content !== null && typeof c.delta.content !== 'string') { c.delta.content = String(c.delta.content); changed = true }
    }
    return changed ? `data: ${JSON.stringify(chunk)}` : line
  } catch { return line }
}

function sseFixer() {
  let buf = ''
  return new TransformStream({
    transform(text, out) {
      buf += text
      const lines = buf.split('\n'); buf = lines.pop()
      for (const l of lines) out.enqueue(fixChunk(l) + '\n')
    },
    flush(out) { if (buf) out.enqueue(fixChunk(buf)) },
  })
}

/** A fetch for Workers AI (direct or through the game's Worker). `base` defaults to the global fetch at call time. */
export function workersAIFetch(base) {
  return async (input, init) => {
    const res = await (base ?? globalThis.fetch)(input, fixRequest(init))
    if (!res.body || !(res.headers.get('content-type') ?? '').includes('event-stream')) return res
    const body = res.body.pipeThrough(new TextDecoderStream()).pipeThrough(sseFixer()).pipeThrough(new TextEncoderStream())
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers })
  }
}

/** Make every request of an API implementation use `fetch` unless the caller passed one. */
export const withFetch = (streams, fetch) => ({
  ...streams,
  stream: (model, context, options) => streams.stream(model, context, { ...options, fetch: options?.fetch ?? fetch }),
  streamSimple: (model, context, options) => streams.streamSimple(model, context, { ...options, fetch: options?.fetch ?? fetch }),
})
