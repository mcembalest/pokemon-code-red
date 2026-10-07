// Model access through pi-ai. Every Pokémon thinks with a Cloudflare Workers AI model.
// pi-ai's Workers AI catalog lacks the small Llamas we test, so we register one provider
// with pi's catalog + our extra entries, using pi's own Cloudflare stream + auth pieces.
// Auth (pi-ai convention): env CLOUDFLARE_API_KEY + CLOUDFLARE_ACCOUNT_ID.
import { createModels, createProvider } from '@earendil-works/pi-ai/models'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { cloudflareStreams } from '@earendil-works/pi-ai/providers/cloudflare-stream'
import { cloudflareWorkersAIAuth } from '@earendil-works/pi-ai/providers/cloudflare-auth'
import { CLOUDFLARE_WORKERS_AI_MODELS } from '@earendil-works/pi-ai/providers/cloudflare-workers-ai.models'

export const PROVIDER = 'cloudflare-workers-ai'
const BASE_URL = 'https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/v1'

/** Workers AI chat models missing from pi-ai's catalog. Costs: $ per 1M tokens (Workers AI pricing). */
export const EXTRA_MODELS = [
  { id: '@cf/meta/llama-3.2-3b-instruct', name: 'Llama 3.2 3B', cost: { input: 0.051, output: 0.34 }, contextWindow: 128000 },
  { id: '@cf/meta/llama-3.2-1b-instruct', name: 'Llama 3.2 1B', cost: { input: 0.027, output: 0.201 }, contextWindow: 60000 },
  { id: '@cf/qwen/qwen2.5-coder-32b-instruct', name: 'Qwen 2.5 Coder 32B', cost: { input: 0.66, output: 1.0 }, contextWindow: 32768 },
]

const toModel = m => ({
  id: m.id, name: m.name, api: 'openai-completions', provider: PROVIDER, baseUrl: BASE_URL,
  reasoning: false, input: ['text'], cost: { cacheRead: 0, cacheWrite: 0, ...m.cost },
  contextWindow: m.contextWindow, maxTokens: 4096,
  compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: false, supportsLongCacheRetention: false, sendSessionAffinityHeaders: true },
  type: 'chat',
})

export function workersAIProvider() {
  const known = new Set(Object.values(CLOUDFLARE_WORKERS_AI_MODELS).map(m => m.id))
  return createProvider({
    id: PROVIDER,
    name: 'Cloudflare Workers AI',
    auth: { apiKey: cloudflareWorkersAIAuth() },
    models: [...Object.values(CLOUDFLARE_WORKERS_AI_MODELS), ...EXTRA_MODELS.filter(m => !known.has(m.id)).map(toModel)],
    api: cloudflareStreams(openAICompletionsApi()),
  })
}

/** A pi-ai Models collection for the game. `extra` providers (e.g. a faux one in tests) are added too. */
export function gameModels(...extra) {
  const models = createModels()
  models.setProvider(workersAIProvider())
  for (const p of extra) models.setProvider(p)
  return models
}

export const modelRef = id => ({ provider: PROVIDER, modelId: id })

/**
 * The game's own route (Worker `/v1/ai`, OpenAI-compatible): what the browser uses.
 * The player's session token is the API key; the Worker holds the Cloudflare side.
 * @param {{ baseUrl: string, token: string | (() => string | Promise<string>), modelIds?: string[] }} o
 */
export function gameApiProvider({ baseUrl, token, modelIds = ['@cf/meta/llama-3.2-3b-instruct', '@cf/ibm-granite/granite-4.0-h-micro'] }) {
  const all = [...EXTRA_MODELS.map(toModel), ...Object.values(CLOUDFLARE_WORKERS_AI_MODELS)]
  return createProvider({
    id: GAME_PROVIDER,
    name: 'Code Red',
    auth: { apiKey: { name: 'Code Red session', resolve: async () => { const key = typeof token === 'function' ? await token() : token; return key ? { auth: { apiKey: key }, source: 'session' } : undefined } } },
    models: modelIds.map(id => ({ ...all.find(m => m.id === id), provider: GAME_PROVIDER, baseUrl })).filter(m => m.id),
    api: openAICompletionsApi(),
  })
}
export const GAME_PROVIDER = 'code-red'
