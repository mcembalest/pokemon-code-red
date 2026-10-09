// Client for the Code Red backend (worker/). Invite-gated account, then a
// batched event queue for progress tracking. Everything here is best-effort:
// if the backend is unreachable the game keeps working.

export const DEFAULT_API = 'https://code-red-api.macembalest.workers.dev'

export interface Features { agents: boolean }
export interface Session { token: string; player: { id: string; name: string; username?: string }; features?: Features; active?: boolean }
/** A cloud save: the game's battery save plus the party's minds (readers, hot memory, Pokédex). */
export interface CloudSave { version: number; at: number; rom: string | null; sram: Uint8Array; minds: unknown }
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

  /** Sign up with an invite; the account (username + password) lets the player log in on another device. */
  join(invite: string, name: string, username: string, password: string): Promise<Session> {
    return this.signIn('/v1/join', { invite: invite.trim(), name: name.trim(), username: username.trim(), password },
      status => status === 403 ? 'That invite code is not valid (or was already used).' : status === 409 ? 'That username is taken.' : 'Could not join. Try again.')
  }

  /** Log in on this device; it becomes the active one (the other device is signed out of play). */
  login(username: string, password: string): Promise<Session> {
    return this.signIn('/v1/login', { username: username.trim(), password },
      status => status === 401 ? 'Wrong username or password.' : status === 429 ? 'Too many attempts. Try again in 15 minutes.' : 'Could not log in. Try again.')
  }

  private async signIn(path: string, payload: Record<string, string>, why: (status: number) => string): Promise<Session> {
    let response: Response
    try {
      response = await this.http(this.api + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    } catch { throw new BackendError(0, 'Could not reach the Code Red server. Check your connection and try again.') }
    const body = await response.json().catch(() => ({})) as { token?: string; player?: Session['player']; features?: Features; active?: boolean; error?: string }
    if (!response.ok || !body.token || !body.player) {
      throw new BackendError(response.status, response.status === 400 && body.error ? body.error : why(response.status))
    }
    const player: Session['player'] = { id: body.player.id, name: body.player.name, ...(body.player.username ? { username: body.player.username } : {}) }
    const session: Session = { token: body.token, player, active: body.active !== false, ...(body.features ? { features: body.features } : {}) }
    this.store.set(session)
    return session
  }

  /** Is this device still the active one? Cached from the last check/sign-in (true until told otherwise). */
  get active(): boolean { return this.session?.active !== false }

  /** Upload a save (active device only; 409 when another device took over). */
  async putSave(save: { sram: Uint8Array; minds: unknown; rom?: string; note?: string }): Promise<{ version: number; same_sram: boolean }> {
    const session = this.session
    if (!session) throw new BackendError(401, 'Not signed in.')
    let response: Response
    try {
      response = await this.http(this.api + '/v1/save', {
        method: 'PUT', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + session.token },
        body: JSON.stringify({ sram: toBase64(save.sram), minds: save.minds ?? {}, rom: save.rom, note: save.note }),
      })
    } catch { throw new BackendError(0, 'Could not reach the Code Red server.') }
    const body = await response.json().catch(() => ({})) as { version?: number; same_sram?: boolean; error?: string }
    if (response.status === 409) this.store.set({ ...session, active: false })
    if (response.status === 401) this.store.set(null)
    if (!response.ok || typeof body.version !== 'number') throw new BackendError(response.status, body.error || `save failed (${response.status})`)
    return { version: body.version, same_sram: !!body.same_sram }
  }

  /** The latest cloud save, or null when there is none yet. */
  async getSave(): Promise<CloudSave | null> {
    const session = this.session
    if (!session) throw new BackendError(401, 'Not signed in.')
    let response: Response
    try { response = await this.http(this.api + '/v1/save', { headers: { authorization: 'Bearer ' + session.token } }) }
    catch { throw new BackendError(0, 'Could not reach the Code Red server.') }
    if (response.status === 401) { this.store.set(null); throw new BackendError(401, 'Signed out.') }
    const body = await response.json().catch(() => ({})) as { version?: number; at?: number; rom?: string | null; sram?: string; minds?: unknown; error?: string }
    if (!response.ok) throw new BackendError(response.status, body.error || `could not load the save (${response.status})`)
    if (!body.version || !body.sram) return null
    return { version: body.version, at: body.at ?? 0, rom: body.rom ?? null, sram: fromBase64(body.sram), minds: body.minds ?? {} }
  }

  /** 'ok' | 'inactive' (another device logged in; this one may look but not play or save) | 'invalid' (token rejected; session cleared) | 'offline' */
  async check(): Promise<'ok' | 'inactive' | 'invalid' | 'offline'> {
    const session = this.session
    if (!session) return 'invalid'
    try {
      const response = await this.http(this.api + '/v1/me', { headers: { authorization: 'Bearer ' + session.token } })
      if (response.status === 401) { this.store.set(null); return 'invalid' }
      if (!response.ok) return 'offline'
      const body = await response.json().catch(() => ({})) as { features?: Features; active?: boolean; player?: Session['player'] }
      const active = body.active !== false
      this.store.set({ ...session, active, ...(body.features ? { features: body.features } : {}), ...(body.player?.username ? { player: { ...session.player, username: body.player.username } } : {}) })
      return active ? 'ok' : 'inactive'
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

export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export function fromBase64(text: string): Uint8Array {
  const s = atob(text)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}
