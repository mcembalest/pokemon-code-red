// Battery saves (.sav), not emulator states.
//
// Emulator states are tied to one exact ROM + core; every Code Red update
// would orphan them. The in-game save survives updates as long as the save
// structs are unchanged. Two copies are kept:
//   1. EmulatorJS's own IDBFS file at getSaveFilePath() (stable because the
//      player uses a fixed EJS_gameName)
//   2. a backup in our IndexedDB under SAVE_KEY, restored if (1) is missing
import { SAVE_KEY } from './storage.ts'

export interface SaveFS {
  analyzePath(path: string): { exists: boolean }
  mkdir(path: string): void
  writeFile(path: string, data: Uint8Array): void
}
export interface SaveGame {
  FS: SaveFS
  getSaveFilePath(): string
  getSaveFile(save?: boolean): Uint8Array | null
  saveSaveFiles(): void
  loadSaveFiles(): void
  restart(): void
}
export interface SaveStore {
  read(key: string): Promise<ArrayBuffer | undefined>
  write(key: string, bytes: Uint8Array): Promise<void>
}

function ensureDir(fs: SaveFS, file: string) {
  let path = ''
  for (const part of file.split('/').slice(0, -1)) {
    if (!part) continue
    path += '/' + part
    if (!fs.analyzePath(path).exists) fs.mkdir(path)
  }
}

/** Call once the game has started. Restores the backup only when the emulator has no save. */
export async function restoreSave(game: SaveGame, store: SaveStore): Promise<'emulator' | 'backup' | 'none'> {
  const path = game.getSaveFilePath()
  if (game.FS.analyzePath(path).exists) return 'emulator'
  let backup: ArrayBuffer | undefined
  try { backup = await store.read(SAVE_KEY) } catch { return 'none' }
  if (!backup || !backup.byteLength) return 'none'
  ensureDir(game.FS, path)
  game.FS.writeFile(path, new Uint8Array(backup))
  game.loadSaveFiles()
  game.restart() // boot again so the title screen sees the restored save
  return 'backup'
}

function fingerprint(bytes: Uint8Array): string {
  let hash = 2166136261
  for (let i = 0; i < bytes.length; i++) hash = Math.imul(hash ^ bytes[i]!, 16777619)
  return `${bytes.length}:${hash >>> 0}`
}

/** Flush SRAM to both copies periodically and whenever the page hides. */
export function autosave(game: SaveGame, store: SaveStore, everyMs = 10_000) {
  let last = '', disposed = false, writing: Promise<void> = Promise.resolve()
  const flush = () => {
    if (disposed) return writing
    let bytes: Uint8Array | null = null
    try { game.saveSaveFiles(); bytes = game.getSaveFile(false) } catch { return writing }
    if (!bytes || !bytes.length) return writing
    const print = fingerprint(bytes)
    if (print === last) return writing
    const copy = bytes.slice()
    writing = writing.then(() => store.write(SAVE_KEY, copy)).then(() => { last = print }, () => {})
    return writing
  }
  const hidden = () => { if (document.hidden) void flush() }
  const timer = setInterval(() => void flush(), everyMs)
  document.addEventListener('visibilitychange', hidden)
  window.addEventListener('pagehide', flush)
  return {
    flush,
    dispose() {
      void flush()
      disposed = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', hidden)
      window.removeEventListener('pagehide', flush)
    },
  }
}
