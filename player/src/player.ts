// Code Red browser player. Embeddable: mount(root, { assets }) where `assets`
// is the URL of the built player bundle (player/dist), e.g. '/code-red/'.
import './player.css'
import { bindGameLifecycle, type LifecycleGame } from './game-lifecycle.ts'
import { createRepl } from './repl.ts'
import { bindGameText } from './game-text.ts'
import { BASE_SHA1, ROM_SIZE, sha1 } from './patch.ts'
import { bindGameKeyboard, type GameInput } from './keyboard.ts'
import { createSpeed, type SpeedControls } from './speed.ts'
import { applyCopyPatch } from './copy-patch.ts'
import { restoreRom } from './rom-cache.ts'
import { readLocal, writeLocal, romKey, SOURCE_KEY } from './storage.ts'
import { autosave, restoreSave, type SaveGame } from './saves.ts'
import { GbaMemory, isCodeRedCore } from './bridge/memory.ts'
import { CalcMailbox } from './bridge/calc.ts'
import { CalcController } from './bridge/calc-controller.ts'
import { NamingMailbox } from './bridge/naming.ts'
import { Backend, DEFAULT_API, localSessionStore } from './backend.ts'
import { ProgressWatcher, readSnapshot } from './progress.ts'

/** Written by the build next to the copy patch (scripts/bundle.py). */
export interface RomInfo {
  base_sha1: string
  rom_sha1: string
  patch: string
  symbols: Record<string, { address: number; bytes: number }>
}

type GameManager = GameInput & SaveGame & LifecycleGame & { Module: unknown; functions: SpeedControls }
type EmulatorWindow = Window & {
  EJS_player?: string; EJS_core?: string; EJS_gameUrl?: string; EJS_gameName?: string
  EJS_pathtodata?: string; EJS_DEBUG_XX?: boolean; EJS_startOnLoaded?: boolean
  EJS_disableDatabases?: boolean; EJS_threads?: boolean
  EJS_paths?: Record<string, string>
  EJS_defaultOptions?: Record<string, string>
  EJS_Buttons?: Record<string, boolean | { visible?: boolean; displayName?: string }>
  EJS_onGameStart?: () => void
  EJS_emulator?: {
    on(event: string, callback: () => void): void
    paused: boolean; pause(dontUpdate?: boolean): void; play(dontUpdate?: boolean): void
    settingsMenu: HTMLElement; controlPopup: HTMLElement; isPopupOpen(): boolean
    gameManager: GameManager
  }
}

const TEMPLATE = `
  <form class="code-red-join" data-join hidden>
    <p>Code Red is invite-only for now.</p>
    <label>Invite code <input data-invite required autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="RED-XXXX-XXXX" /></label>
    <label>Your name <input data-name required maxlength="24" autocomplete="nickname" /></label>
    <button class="code-red-button" type="submit">Join</button>
  </form>
  <div data-open hidden>
    <p class="code-red-muted">Open your Pokémon FireRed (USA, v1.0) .gba file once. It stays on this device.</p>
    <button class="code-red-button" data-choose type="button">Open FireRed file</button>
    <input data-file type="file" accept=".gba,application/octet-stream" hidden />
  </div>
  <p class="code-red-status" data-status role="status" aria-live="polite">Loading…</p>
  <p class="code-red-error" data-error role="alert" hidden></p>
  <p class="code-red-muted code-red-help"><span data-who hidden></span>PC → Code opens a JavaScript scratchpad. Type names on naming screens. Tap 10× to speed up (or hold Space on a keyboard). Your in-game save is kept in this browser and survives updates.</p>
  <div class="code-red-game" data-game hidden aria-label="Code Red game"><div id="code-red-game"></div></div>
  <div class="code-red-toolbar" data-toolbar hidden>
    <button class="code-red-speed" data-speed type="button" aria-pressed="false">10×</button>
  </div>`

/** api: backend URL; default = the hosted backend; false = no account or tracking (local dev, tests). */
export function mount(root: HTMLElement, options: { assets: string; api?: string | false }) {
  const assets = options.assets.endsWith('/') ? options.assets : options.assets + '/'
  root.classList.add('code-red')
  root.innerHTML = TEMPLATE
  const input = root.querySelector<HTMLInputElement>('[data-file]')!
  const chooser = root.querySelector<HTMLElement>('[data-open]')!
  const status = root.querySelector<HTMLElement>('[data-status]')!
  const error = root.querySelector<HTMLElement>('[data-error]')!
  const game = root.querySelector<HTMLElement>('[data-game]')!
  const toolbar = root.querySelector<HTMLElement>('[data-toolbar]')!
  const speedButton = root.querySelector<HTMLButtonElement>('[data-speed]')!
  const joinForm = root.querySelector<HTMLFormElement>('[data-join]')!
  const who = root.querySelector<HTMLElement>('[data-who]')!
  const api = options.api === false ? null : options.api || DEFAULT_API
  const backend = api ? new Backend(api, localSessionStore()) : null
  if (backend) backend.start()
  const emulator = window as EmulatorWindow
  const disposers: (() => void)[] = []
  let info: RomInfo | undefined
  let loaded = false, remembered = false, consoleActive = false, resumeConsole = false
  let gameUrl: string | undefined

  const say = (text: string) => { status.textContent = text }
  const fail = (text: string) => { error.textContent = text; error.hidden = false }
  const resume = () => {
    consoleActive = false
    if (resumeConsole && !document.hidden) { resumeConsole = false; emulator.EJS_emulator?.play(true) }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !consoleActive) resume() })
  window.addEventListener('pagehide', event => {
    if (event.persisted) return
    while (disposers.length) disposers.pop()!()
    if (gameUrl) URL.revokeObjectURL(gameUrl)
  })
  root.querySelector<HTMLButtonElement>('[data-choose]')!.onclick = () => input.click()

  const showWho = () => {
    const name = backend?.session?.player.name
    who.hidden = !name
    who.textContent = name ? `Playing as ${name}. ` : ''
  }

  /** Resolves once there is an account (or no backend). Shows the invite form if needed. */
  function account(): Promise<void> {
    if (!backend) return Promise.resolve()
    if (backend.session) {
      showWho()
      // Token revoked? Offer the form again without interrupting play.
      void backend.check().then(state => { if (state === 'invalid') void join() })
      return Promise.resolve()
    }
    return join()
  }

  function join(): Promise<void> {
    const invite = joinForm.querySelector<HTMLInputElement>('[data-invite]')!
    const name = joinForm.querySelector<HTMLInputElement>('[data-name]')!
    const fromLink = new URLSearchParams(location.search).get('invite')
    if (fromLink && !invite.value) invite.value = fromLink
    joinForm.hidden = false
    who.hidden = true
    ;(invite.value ? name : invite).focus({ preventScroll: true })
    return new Promise(resolve => {
      joinForm.onsubmit = async event => {
        event.preventDefault()
        const button = joinForm.querySelector<HTMLButtonElement>('button')!
        button.disabled = true
        error.hidden = true
        try {
          await backend!.join(invite.value, name.value)
          joinForm.hidden = true
          joinForm.onsubmit = null
          if (fromLink) {
            const url = new URL(location.href); url.searchParams.delete('invite')
            history.replaceState(history.state, '', url)
          }
          showWho()
          resolve()
        } catch (problem) {
          fail(problem instanceof Error ? problem.message : 'Could not join.')
        } finally { button.disabled = false }
      }
    })
  }

  function trackProgress(memory: GbaMemory, rom: RomInfo) {
    if (!backend) return
    const s = rom.symbols
    if (!s.gPlayerParty || !s.gPlayerPartyCount) return // older build
    const symbols = { saveBlock1Ptr: s.gSaveBlock1Ptr!.address, saveBlock2Ptr: s.gSaveBlock2Ptr!.address, partyCount: s.gPlayerPartyCount.address, party: s.gPlayerParty.address }
    const watcher = new ProgressWatcher(() => memory.ready() ? readSnapshot(memory, symbols) : null, (kind, data) => backend.track(kind, data))
    const timer = setInterval(() => watcher.tick(), 2000)
    const hide = () => { if (document.visibilityState === 'hidden') { watcher.finalSnapshot(); backend.flushOnHide() } }
    const pagehide = () => { watcher.finalSnapshot(); backend.flushOnHide() }
    document.addEventListener('visibilitychange', hide)
    window.addEventListener('pagehide', pagehide)
    disposers.push(() => { clearInterval(timer); document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', pagehide) })
  }

  async function romInfo(): Promise<RomInfo> {
    if (info) return info
    const response = await fetch(assets + 'rom/rom.json', { cache: 'no-cache' })
    if (!response.ok) throw new Error('This Code Red build is missing its rom.json.')
    const parsed = await response.json() as RomInfo
    if (parsed.base_sha1 !== BASE_SHA1) throw new Error('This Code Red build expects a different base game.')
    return info = parsed
  }

  async function patchSource(bytes: Uint8Array): Promise<Uint8Array> {
    const { patch, rom_sha1 } = await romInfo()
    const response = await fetch(assets + 'rom/' + patch)
    if (!response.ok) throw new Error('The patch could not load. Reload and try again.')
    const stream = new Blob([await response.arrayBuffer()]).stream().pipeThrough(new DecompressionStream('gzip'))
    const patched = applyCopyPatch(bytes, new Uint8Array(await new Response(stream).arrayBuffer()))
    if (await sha1(patched) !== rom_sha1) throw new Error('Patch verification failed. Reload and try again.')
    return patched
  }

  function attachBridge(gm: GameManager, rom: RomInfo) {
    if (!isCodeRedCore(gm.Module)) throw new Error('The Code Red emulator core did not load.')
    const memory = new GbaMemory(gm.Module)
    const epoch = () => memory.epoch()
    const ejs = emulator.EJS_emulator!
    const menuOpen = () => ejs.settingsMenu.style.display !== 'none' || ejs.isPopupOpen()
    return { memory, epoch, menuOpen, symbol: (name: string) => {
      const entry = rom.symbols[name]
      if (!entry) throw new Error(`rom.json has no ${name}.`)
      return entry.address
    } }
  }

  async function onGameStart(rom: RomInfo) {
    const ejs = emulator.EJS_emulator!
    const gm = ejs.gameManager
    try {
      const { epoch, menuOpen, memory, symbol } = attachBridge(gm, rom)
      trackProgress(memory, rom)
      const runnerPath = assets + 'runner/client.js'
      const { Runner } = await import(/* @vite-ignore */ runnerPath)
      let finish: ((result?: number) => void) | undefined
      const repl = createRepl({ runner: new Runner(), onClose: value => { const done = finish; finish = undefined; done?.(value); resume() } })
      const calc = new CalcController(new CalcMailbox(memory, symbol('gCodeRedMailbox')), new Runner(), {
        open: (request, done) => {
          keyboard.release(); finish = done; consoleActive = true
          resumeConsole = !ejs.paused; ejs.pause(true)
          repl.open(request.stats, `${request.epoch}:${request.id}`)
        },
        close: () => { finish = undefined; repl.close(); resume() },
      })
      const lifecycle = bindGameLifecycle(gm, () => { if (consoleActive) { calc.cancel(true); keyboard.release() } })
      const naming = bindGameText(game, new NamingMailbox(memory, symbol('gCodeRedNamingMailbox')), epoch, () => keyboard.release(), () => consoleActive || menuOpen())
      const speed = createSpeed(gm.functions, (on, toggled) => {
        speedButton.setAttribute('aria-pressed', String(toggled))
        speedButton.classList.toggle('code-red-speed-on', on)
      })
      // click covers tap, mouse and keyboard; pointerdown preventDefault keeps focus on the game.
      speedButton.onpointerdown = event => event.preventDefault()
      speedButton.onclick = () => speed.toggle()
      toolbar.hidden = false
      disposers.push(() => { speed.reset(); toolbar.hidden = true; speedButton.onpointerdown = speedButton.onclick = null })
      const keyboard = bindGameKeyboard(game, gm, speed, epoch, () => consoleActive || menuOpen() || ejs.controlPopup.parentElement!.parentElement!.getAttribute('hidden') === null)
      disposers.push(() => keyboard.dispose(), () => lifecycle.dispose(), () => naming.dispose(), () => calc.dispose(), () => repl.dispose())
      ejs.on('exit', () => { while (disposers.length) disposers.pop()!() })
    } catch (problem) {
      fail(problem instanceof Error ? problem.message : 'The code bridge could not start.')
    }
    const store = { read: readLocal, write: writeLocal }
    const restored = await restoreSave(gm, store).catch(() => 'none' as const)
    const saver = autosave(gm, store)
    disposers.push(() => saver.dispose())
    backend?.track('session_start', { rom: rom.rom_sha1.slice(0, 12), save: restored, touch: navigator.maxTouchPoints > 0 })
    void backend?.flush()
    say(restored === 'backup' ? 'Restored your save.' : remembered ? '' : 'Playing. Browser storage is unavailable; reopen the file next time.')
    game.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function start(bytes: Uint8Array) {
    // EmulatorJS builds its (hidden) screen-recording settings at startup and
    // throws if MediaRecorder is missing (some WebKit builds). Recording is off.
    if (typeof (window as { MediaRecorder?: unknown }).MediaRecorder === 'undefined') {
      (window as { MediaRecorder?: unknown }).MediaRecorder = { isTypeSupported: () => false }
    }
    const rom = await romInfo()
    gameUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: 'application/octet-stream' }))
    Object.assign(emulator, {
      EJS_player: '#code-red-game',
      EJS_core: 'gba',
      EJS_gameName: 'Pokemon Code Red', // fixed: the battery save path derives from it
      EJS_gameUrl: gameUrl,
      EJS_pathtodata: assets + 'emulator/',
      EJS_DEBUG_XX: true, // use the local, unminified pinned runtime
      EJS_startOnLoaded: true,
      EJS_disableDatabases: true,
      EJS_threads: false,
      // Both renderer variants are Code Red builds. EmulatorJS picks one: legacy
      // (WebGL1) by default for GBA, WebGL2 only if the user enables it in settings.
      EJS_paths: {
        'mgba-wasm.data': assets + 'emulator/cores/code-red-mgba-wasm.data',
        'mgba-legacy-wasm.data': assets + 'emulator/cores/code-red-mgba-legacy-wasm.data',
      },
      EJS_defaultOptions: {
        'virtual-gamepad': navigator.maxTouchPoints > 0 ? 'enabled' : 'disabled',
        'save-save-interval': '30',
      },
      EJS_Buttons: {
        cheat: false, gamepad: false, cacheManager: false, netplay: false, diskButton: false,
        screenRecord: false, screenshot: false, quickSave: false, quickLoad: false,
        saveState: false, loadState: false,
        saveSavFiles: { displayName: 'Export save' }, loadSavFiles: { displayName: 'Import save' },
      },
      EJS_onGameStart: () => { void onGameStart(rom) },
    } satisfies Partial<EmulatorWindow>)
    chooser.hidden = true
    game.hidden = false
    say('Starting…')
    const script = document.createElement('script')
    script.src = assets + 'emulator/loader.js'
    script.onerror = () => say('The player could not start. Reload to try again.')
    document.body.appendChild(script)
    loaded = true
  }

  input.addEventListener('change', async () => {
    const file = input.files?.[0]
    if (!file || loaded) return
    error.hidden = true
    input.disabled = true
    say('Opening…')
    try {
      if (file.size !== ROM_SIZE) throw new Error('Choose a 16 MB Pokémon FireRed (USA, v1.0) .gba file.')
      const { rom_sha1 } = await romInfo()
      let bytes: Uint8Array = new Uint8Array(await file.arrayBuffer())
      const digest = await sha1(bytes)
      let sourceRemembered = false
      if (digest === BASE_SHA1) {
        try { await writeLocal(SOURCE_KEY, bytes); sourceRemembered = true } catch { /* play without storage */ }
        bytes = await patchSource(bytes)
      } else if (digest !== rom_sha1) {
        throw new Error('That is not Pokémon FireRed (USA, v1.0). Rev 1, LeafGreen and other versions will not work.')
      }
      try { await writeLocal(romKey(rom_sha1), bytes); remembered = true } catch { remembered = sourceRemembered }
      await start(bytes)
    } catch (problem) {
      input.disabled = false
      input.value = ''
      say('')
      fail(problem instanceof Error ? problem.message : 'Could not open this file.')
    }
  })

  input.disabled = true
  void (async () => {
    try {
      await account()
      const { rom_sha1 } = await romInfo()
      const restored = await restoreRom({ read: readLocal, write: writeLocal, patch: patchSource }, rom_sha1)
      if (restored) { remembered = restored.remembered; await start(restored.bytes); return }
      say('')
    } catch (problem) {
      say('')
      fail(problem instanceof Error ? problem.message : 'Could not restore the game. Reload to try again.')
    }
    input.disabled = false
    chooser.hidden = false
  })()
}
