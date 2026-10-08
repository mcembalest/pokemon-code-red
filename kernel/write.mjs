// One battle turn's code, streamed: the prompt comes from rules/turn.mjs (turnPrompt), the reply is
// streamed token by token (for the code panel), and the final text is returned for judging.
export const BATTLE_MODEL = '@cf/meta/llama-3.2-3b-instruct'

/**
 * models: a pi-ai Models with the game provider set (gameApiProvider); model: { provider, modelId }.
 * onText(delta) gets each streamed piece. Throws on a model or network error (the caller retries / falls back).
 */
export async function writeCode({ models, model, system, user, temperature, maxTokens = 400, onText, signal }) {
  const m = models.getModel(model.provider, model.modelId)
  if (!m) throw new Error(`unknown model ${model.provider}/${model.modelId}`)
  const stream = models.streamSimple(m, { systemPrompt: system, messages: [{ role: 'user', content: user, timestamp: Date.now() }] }, { temperature, maxTokens, signal })
  for await (const event of stream) if (event.type === 'text_delta') onText?.(event.delta)
  const message = await stream.result()
  if (message.stopReason === 'error' || message.stopReason === 'aborted') throw new Error(message.errorMessage || message.stopReason)
  const text = (message.content ?? []).filter(c => c.type === 'text').map(c => c.text).join('')
  return { text, usage: message.usage }
}
