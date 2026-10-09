// Cloud saves (owner direction, 2026-10-06): the in-game save is the only commit point. A save bundle is
// the game's battery save (SRAM) plus the party's minds (readers, hot memory, Pokédex). Every version is
// kept on the backend. One device is "active" at a time: logging in elsewhere takes over, and the old
// device may keep looking but stops playing and saving.
//
//   start: restore from the cloud when there is no local save, or when the cloud has a version this
//          device never synced (someone saved on another device). Otherwise keep the local save.
//   play:  every SRAM change (an in-game save) uploads SRAM + minds; the version comes back and is
//          remembered as "synced" so the next start keeps the local copy.
//   lost:  a 409 on upload or active:false from /v1/me → the page pauses and offers "play here" (log in again).
import type { Backend, CloudSave } from './backend.ts'
import { installSave, type SaveGame } from './saves.ts'

export type RestoreChoice = 'cloud' | 'local' | 'none'

/** Which save to boot with. `synced` = the last cloud version this device uploaded or restored (0 = never). */
export function decideRestore(localExists: boolean, synced: number, cloud: { version: number } | null): RestoreChoice {
  if (!cloud) return localExists ? 'local' : 'none'
  if (!localExists) return 'cloud'
  return cloud.version > synced ? 'cloud' : 'local'
}

export interface SyncMark { get(): number; set(version: number): void }

export function localSyncMark(storage: Pick<Storage, 'getItem' | 'setItem'> | null, key = 'code-red-cloud-version'): SyncMark {
  return {
    get() { try { return Number(storage?.getItem(key)) || 0 } catch { return 0 } },
    set(version) { try { storage?.setItem(key, String(version)) } catch { /* in memory only */ } },
  }
}

export interface Minds { export?(): unknown; import?(state: unknown): void }

export interface CloudSyncOptions {
  game: SaveGame
  backend: Pick<Backend, 'getSave' | 'putSave' | 'check' | 'active'>
  minds: Minds
  mark: SyncMark
  rom?: string
  /** Another device took over (409 / active:false), or this one is active again. */
  onActive?: (active: boolean) => void
  onSynced?: (version: number) => void
  log?: (text: string) => void
}

export class CloudSync {
  private uploading: Promise<void> = Promise.resolve()
  private pendingBytes: Uint8Array | null = null
  private wasActive = true
  private readonly o: CloudSyncOptions
  constructor(o: CloudSyncOptions) { this.o = o }

  /** Call once the game has started (before/instead of the local backup restore). */
  async restore(): Promise<RestoreChoice | 'offline'> {
    const { game, backend, minds, mark } = this.o
    const localExists = game.FS.analyzePath(game.getSaveFilePath()).exists
    let cloud: CloudSave | null
    try { cloud = await backend.getSave() } catch { return 'offline' }
    const choice = decideRestore(localExists, mark.get(), cloud)
    if (choice === 'cloud' && cloud) {
      installSave(game, cloud.sram)
      minds.import?.(cloud.minds)
      mark.set(cloud.version)
      this.o.log?.(`restored cloud save v${cloud.version}`)
    }
    return choice
  }

  /** The battery save changed (an in-game save): upload it with the minds. Coalesces bursts. */
  changed(bytes: Uint8Array): Promise<void> {
    this.pendingBytes = bytes
    this.uploading = this.uploading.then(() => this.upload())
    return this.uploading
  }

  private async upload(): Promise<void> {
    const bytes = this.pendingBytes
    this.pendingBytes = null
    if (!bytes || !this.o.backend.active) return
    try {
      const { version } = await this.o.backend.putSave({ sram: bytes, minds: this.o.minds.export?.() ?? {}, rom: this.o.rom })
      this.o.mark.set(version)
      this.o.onSynced?.(version)
    } catch (problem) {
      if ((problem as { status?: number }).status === 409) this.lost()
      else this.o.log?.('cloud save failed; will retry on the next save')
    }
  }

  private lost() {
    if (!this.wasActive) return
    this.wasActive = false
    this.o.onActive?.(false)
  }

  /** Poll /v1/me so a takeover on another device shows up here within a minute. Returns a disposer. */
  watchActive(everyMs = 30_000): () => void {
    const tick = async () => {
      const state = await this.o.backend.check()
      if (state === 'inactive') this.lost()
      else if (state === 'ok' && !this.wasActive) { this.wasActive = true; this.o.onActive?.(true) }
    }
    const timer = setInterval(() => void tick(), everyMs)
    return () => clearInterval(timer)
  }

  /** After a fresh login on this device: it is active again. */
  resumed(): void { if (!this.wasActive) { this.wasActive = true; this.o.onActive?.(true) } }
}
