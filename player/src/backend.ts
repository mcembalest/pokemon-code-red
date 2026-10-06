// Client for the Code Red backend (worker/). Invite-gated account, then a
// batched event queue for progress tracking. Everything here is best-effort:
// if the backend is unreachable the game keeps working.

export const DEFAULT_API = 'https://code-red-api.macembalest.workers.dev'

export interface Session { token: string; player: { id: string; name: string } }
export interface SessionStore { get(): Session | null; set(session: Session | null): void }
export interface TrackedEvent { kind: string; at: number; data?: unknown }

export function localSessionStore(key = 'code-red-session'): SessionStore {
  return {
    get() {
      try {
        const raw = localStorage.getItem(key)
        const parsed = raw ? JSON.parse(raw) as Session : null
        return parsed && typeof parsed.token === 'string' && parsed.player ? parsed : null
      } catch { return null }
    },
    set(session) {
      try { if (session) localStorage.setItem(key, JSON.stringify(session)); else localStorage.removeItem(key) } catch { /* private mode */ }
    },
  }
}

export class BackendError extends Error {
  readonly status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

const MAX_QUEUE = 500
const BATCH = 200

export class Backend {
  private queue: TrackedEvent[] = []
  private flushing: Promise<void> | null = null
  private readonly api: string
  private readonly store: SessionStore
  private readonly http: typeof fetch
  private readonly beacon: (url: string, body: Blob) => boolean

  constructor(
    api: string,
    store: SessionStore,
    http: typeof fetch = (...args) => fetch(...args),
    beacon: (url: string, body: Blob) => boolean = (url, body) => typeof navigator !== 'undefined' && !!navigator.sendBeacon?.(url, body),
  ) {
    this.api = api.replace(/\/+$/, '')
    this.store = store; this.http = http; this.beacon = beacon
  }

  get session(): Session | null { return this.store.get() }
  get pending(): number { return this.queue.length }

  async join(invite: string, name: string): Promise<Session> {
    let response: Response
    try {
      response = await this.http(this.api + '/v1/join', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ invite: invite.trim(), name: name.trim() }),
      })
    } catch { throw new BackendError(0, 'Could not reach the Code Red server. Check your connection and try again.') }
    const body = await response.json().catch(() => ({})) as { token?: string; player?: Session['player']; error?: string }
    if (!response.ok || !body.token || !body.player) {
      throw new BackendError(response.status, response.status === 403 ? 'That invite code is not valid (or was already used).' : body.error || 'Could not join. Try again.')
    }
    const session = { token: body.token, player: { id: body.player.id, name: body.player.name } }
    this.store.set(session)
    return session
  }

  /** 'ok' | 'invalid' (token rejected; session cleared) | 'offline' */
  async check(): Promise<'ok' | 'invalid' | 'offline'> {
    const session = this.session
    if (!session) return 'invalid'
    try {
      const response = await this.http(this.api + '/v1/me', { headers: { authorization: 'Bearer ' + session.token } })
      if (response.status === 401) { this.store.set(null); return 'invalid' }
      return response.ok ? 'ok' : 'offline'
    } catch { return 'offline' }
  }

  /** Agent model call via the worker (Anthropic Messages body; the worker picks/limits the model). */
  async llm(body: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const session = this.session
    if (!session) throw new BackendError(401, 'Join with an invite code to use agents.')
    let response: Response
    try {
      response = await this.http(this.api + '/v1/llm', {
        method: 'POST', signal,
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + session.token },
        body: JSON.stringify(body),
      })
    } catch { throw new BackendError(0, 'Could not reach the Code Red server.') }
    const json = await response.json().catch(() => ({})) as Record<string, unknown>
    if (!response.ok) throw new BackendError(response.status, typeof json.error === 'string' ? json.error : `agent call failed (${response.status})`)
    return json
  }

  track(kind: string, data?: unknown, at = Date.now()): void {
    if (!this.session) return
    this.queue.push(data === undefined ? { kind, at } : { kind, at, data })
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE)
  }

  flush(): Promise<void> {
    this.flushing ??= this.send().finally(() => { this.flushing = null })
    return this.flushing
  }

  private async send(): Promise<void> {
    const session = this.session
    while (session && this.queue.length) {
      const batch = this.queue.splice(0, BATCH)
      let status = 0
      try {
        const response = await this.http(this.api + '/v1/events', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer ' + session.token },
          body: JSON.stringify({ events: batch }),
        })
        status = response.status
      } catch { /* offline */ }
      if (status >= 200 && status < 300) continue
      if (status === 0 || status >= 500 || status === 429) { this.queue.unshift(...batch); return } // retry later
      if (status === 401) this.store.set(null)
      return // other 4xx: drop the batch
    }
  }

  /** Page is going away: hand whatever is queued to sendBeacon (no auth header possible, so the token rides in the body). */
  flushOnHide(): void {
    const session = this.session
    if (!session || !this.queue.length) return
    const batch = this.queue.splice(0, BATCH)
    const body = new Blob([JSON.stringify({ token: session.token, events: batch })], { type: 'text/plain' })
    if (!this.beacon(this.api + '/v1/events', body)) this.queue.unshift(...batch)
  }

  /** Periodic flush + flush on hide. Returns a disposer. */
  start(intervalMs = 15_000): () => void {
    const timer = setInterval(() => { void this.flush() }, intervalMs)
    const hidden = () => { if (document.visibilityState === 'hidden') this.flushOnHide() }
    const pagehide = () => this.flushOnHide()
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('pagehide', pagehide)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', hidden)
      window.removeEventListener('pagehide', pagehide)
    }
  }
}
