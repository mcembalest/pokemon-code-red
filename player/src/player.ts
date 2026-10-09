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
import { autosave, requestPersistence, restoreSave, type SaveGame } from './saves.ts'
import { GbaMemory, isCodeRedCore } from './bridge/memory.ts'
import { CalcMailbox } from './bridge/calc.ts'
import { CalcController } from './bridge/calc-controller.ts'
import { NamingMailbox } from './bridge/naming.ts'
import { Backend, DEFAULT_API, localSessionStore } from './backend.ts'
import { ProgressWatcher, readSnapshot } from './progress.ts'
import { Agent } from './agents/agent.ts'
import { CloudBrain, MockBrain, ReplayBrain } from './agents/brains.ts'
import type { DecisionRecord } from './agents/agent.ts'
import { BattleReader, greedyPolicy, type BattleMon } from './agents/battle.ts'
import { BattleAutopilot, createThinkingBox, type Pad } from './agents/autopilot.ts'
import { CodeBattle, localCodeMemory, mockWriter, type CodeWriter, type Sandbox } from './agents/code-battle.ts'
import { createCodePanel } from './agents/code-panel.ts'
import { CodeMoveMailbox } from './bridge/code-move.ts'
import { createStarterCard, offeredStarter } from './agents/starter-card.ts'

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
  <div class="code-red-stage" data-stage>
    <div class="code-red-game" data-game hidden aria-label="Code Red game"><div id="code-red-game"></div></div>
  </div>
  <div class="code-red-toolbar" data-toolbar hidden>
    <button class="code-red-speed" data-code type="button" aria-pressed="true" hidden>Code</button>
    <button class="code-red-speed" data-agent type="button" aria-pressed="false" hidden>Agent</button>
    <button class="code-red-speed" data-speed type="button" aria-pressed="false">10×</button>
  </div>`

/** api: backend URL; default = the hosted backend; false = no account or tracking (local dev, tests).
 *  agents: force a mode. Default: on (Sonnet 5.5) for every invited player unless the worker turns it off; ?agents=off|mock|replay|on overrides. */
export function mount(root: HTMLElement, options: { assets: string; api?: string | false; agents?: 'cloud' | 'mock' }) {
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
  const codeButton = root.querySelector<HTMLButtonElement>('[data-code]')!
  const stage = root.querySelector<HTMLElement>('[data-stage]')!
  let fastForward = false
  const joinForm = root.querySelector<HTMLFormElement>('[data-join]')!
  const who = root.querySelector<HTMLElement>('[data-who]')!
  const api = options.api === false ? null : options.api || DEFAULT_API
  const backend = api ? new Backend(api, localSessionStore()) : null
  // Agents: on for every invited player (the worker can switch them off: features.agents).
  // ?agents=off|mock|replay|on overrides (testing). No backend (local page) → off unless asked.
  const agentParam = new URLSearchParams(location.search).get('agents')
  let agentsMode: 'cloud' | 'mock' | 'replay' | null = options.agents ?? null
  const resolveAgents = () => {
    if (options.agents) return
    if (agentParam === 'off') agentsMode = null
    else if (agentParam === 'mock' || agentParam === 'replay') agentsMode = agentParam
    else if (agentParam === 'on' || agentParam === 'cloud') agentsMode = 'cloud'
    else agentsMode = backend?.session && backend.session.features?.agents !== false ? 'cloud' : null
  }
  /** Every agent decision this page made (replay format). Exposed as window.CodeRed.agentRecords(). */
  const agentRecords: DecisionRecord[] = []
  ;(window as { CodeRed?: Record<string, unknown> }).CodeRed = { ...(window as { CodeRed?: Record<string, unknown> }).CodeRed, agentRecords: () => agentRecords.slice() }
  const agentButton = root.querySelector<HTMLButtonElement>('[data-agent]')!
  let romBytes: Uint8Array | undefined
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
    say('')
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
          say('Loading…')
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

  let replayRecords: DecisionRecord[] = []
  async function loadReplay() {
    const url = new URLSearchParams(location.search).get('records')
    if (agentsMode !== 'replay' || !url) return
    try { replayRecords = await (await fetch(url)).json() as DecisionRecord[] } catch { fail('Could not load the agent recording.') }
  }

  /** Prototype: lead Pokémon picks its own battle moves (agents/autopilot.ts). Off unless ?agents= is set. */
  function startAgents(gm: GameManager, memory: GbaMemory, rom: RomInfo, runner: Sandbox) {
    if (!agentsMode || !romBytes || !BattleReader.supported(rom.symbols)) return
    const ejs = emulator.EJS_emulator!
    const reader = new BattleReader(memory, romBytes, rom.symbols)
    let moves: BattleMon['moves'] = []
    const mock = new MockBrain(request => greedyPolicy(moves)(request))
    const brain = agentsMode === 'replay' ? new ReplayBrain(replayRecords, mock)
      : agentsMode === 'mock' || !backend ? mock
      : new CloudBrain((body, signal) => backend.llm(body, signal))
    const agent = new Agent({ id: 'lead', name: 'LEAD', persona: '', actions: [{ id: 'wait', description: 'placeholder' }] }, brain)
    const frames = () => (gm.functions as unknown as { getFrameNum(): number }).getFrameNum()
    const waitFrames = (n: number) => new Promise<void>(resolve => {
      const start = frames(), deadline = Date.now() + 3000
      const t = setInterval(() => { if (frames() >= start + n || Date.now() > deadline) { clearInterval(t); resolve() } }, 4)
    })
    const pad: Pad = {
      async press(key, hold = 2, after = 8) { gm.simulateInput(0, key, 1); await waitFrames(hold); gm.simulateInput(0, key, 0); await waitFrames(after) },
      pause: () => ejs.pause(true),
      play: () => { if (!consoleActive) ejs.play(true) },
    }
    const box = createThinkingBox(game)
    startCodeMoves(gm, memory, rom, runner, reader)
    // First agent moment: the starter card in Oak's lab.
    const tasks = rom.symbols.gTasks, monPic = rom.symbols['script_menu.Task_ScriptShowMonPic']
    if (tasks && monPic) {
      const card = createStarterCard(game, () => memory.ready() ? offeredStarter(memory, { gTasks: tasks.address, monPicTask: monPic.address, saveBlock1Ptr: rom.symbols.gSaveBlock1Ptr!.address }) : null,
        species => backend?.track('starter_card', { species }))
      disposers.push(() => card.dispose())
    }
    const pilot = new BattleAutopilot(reader, agent, box, pad, {
      onDecision: r => {
        agentRecords.push(r)
        backend?.track('agent_decision', { brain: r.brain, key: r.key, observation: r.observation, action: r.decision.action, args: r.decision.args, thought: r.decision.thought, ms: r.ms, ...(r.fallback ? { fallback: r.fallback } : {}) })
      },
    })
    // The mock policy scores the current moves; refresh them each tick.
    const refresh = setInterval(() => { try { if (reader.inBattle()) moves = reader.mon(0).moves } catch { /* memory not ready */ } }, 250)
    // The player picks moves (owner, 2026-10-06). The move-picking autopilot is a test
    // harness only: on with an explicit ?agents=mock|replay|on.
    if (!agentParam || agentParam === 'off') { disposers.push(() => { clearInterval(refresh); box.element.remove() }); return }
    const stop = pilot.start()
    pilot.setEnabled(true)
    agentButton.setAttribute('aria-pressed', 'true')
    agentButton.classList.add('code-red-speed-on')
    agentButton.hidden = false
    agentButton.onpointerdown = event => event.preventDefault()
    agentButton.onclick = () => {
      pilot.setEnabled(!pilot.enabled)
      agentButton.setAttribute('aria-pressed', String(pilot.enabled))
      agentButton.classList.toggle('code-red-speed-on', pilot.enabled)
    }
    disposers.push(() => { stop(); clearInterval(refresh); box.element.remove(); agentButton.hidden = true; agentButton.onclick = agentButton.onpointerdown = null })
  }

  /** Code moves (patches/006-code-moves.patch): both sides write each move; the code panel streams it. */
  function startCodeMoves(gm: GameManager, memory: GbaMemory, rom: RomInfo, runner: Sandbox, reader: BattleReader) {
    const sym = rom.symbols.gCodeRedMove
    if (!sym) return // older ROM build
    const panel = createCodePanel(stage, { fast: () => fastForward })
    const hidden = (() => { try { return localStorage.getItem('code-red-code-panel') === 'hidden' } catch { return false } })()
    panel.setVisible(!hidden)
    codeButton.hidden = false
    codeButton.setAttribute('aria-pressed', String(panel.visible))
    codeButton.classList.toggle('code-red-speed-on', panel.visible)
    codeButton.onpointerdown = event => event.preventDefault()
    codeButton.onclick = () => {
      panel.setVisible(!panel.visible)
      codeButton.setAttribute('aria-pressed', String(panel.visible))
      codeButton.classList.toggle('code-red-speed-on', panel.visible)
      try { localStorage.setItem('code-red-code-panel', panel.visible ? 'shown' : 'hidden') } catch { /* private mode */ }
    }
    const writer: CodeWriter = agentsMode === 'cloud' && backend && api ? cloudWriter(assets, api, () => backend.session?.token ?? '') : mockWriter()
    const s = rom.symbols
    const badgeNames = ['BOULDER', 'CASCADE', 'THUNDER', 'RAINBOW', 'SOUL', 'MARSH', 'VOLCANO', 'EARTH']
    const badges = () => {
      const snap = s.gSaveBlock1Ptr && s.gSaveBlock2Ptr && s.gPlayerParty && s.gPlayerPartyCount && memory.ready()
        ? readSnapshot(memory, { saveBlock1Ptr: s.gSaveBlock1Ptr.address, saveBlock2Ptr: s.gSaveBlock2Ptr.address, partyCount: s.gPlayerPartyCount.address, party: s.gPlayerParty.address }) : null
      return snap ? badgeNames.filter((_, i) => snap.badges >> i & 1) : []
    }
    const minds = localCodeMemory(safeStorage())
    // Until the PokÉEG exists: window.CodeRed.setHot(personality, text) pins hot memory for a Pokémon (dev / testing).
    ;(window as { CodeRed?: Record<string, unknown> }).CodeRed = { ...(window as { CodeRed?: Record<string, unknown> }).CodeRed, setHot: (pid: number, text: string) => minds.setHot(pid, text), hot: (pid: number) => minds.hot(pid), readers: (pid: number) => minds.readers(pid) }
    const battle = new CodeBattle(new CodeMoveMailbox(memory, sym.address), reader, writer, runner, panel, minds, {
      badges,
      onTurn: t => backend?.track('code_move', { ...t, code: t.code?.slice(0, 300) }),
    })
    let inBattle = false
    const poll = setInterval(() => {
      if (!memory.ready()) return
      void battle.poll()
      let now = false
      try { now = reader.inBattle() } catch { /* memory not ready */ }
      if (inBattle && !now) battle.battleOver()
      inBattle = now
    }, 16)
    disposers.push(() => { clearInterval(poll); panel.dispose(); codeButton.hidden = true; codeButton.onclick = codeButton.onpointerdown = null })
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
      const scriptRunner = new Runner()
      disposers.push(() => scriptRunner.dispose())
      startAgents(gm, memory, rom, scriptRunner)
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
        fastForward = on
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
    const persisted = await requestPersistence()
    backend?.track('session_start', { rom: rom.rom_sha1.slice(0, 12), save: restored, touch: navigator.maxTouchPoints > 0, storage: persisted })
    void backend?.flush()
    say(restored === 'backup' ? 'Restored your save.' : remembered ? '' : 'Playing. Browser storage is unavailable; reopen the file next time.')
    game.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function start(bytes: Uint8Array) {
    romBytes = bytes
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
      resolveAgents()
      await loadReplay()
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

const safeStorage = (): Storage | null => { try { return localStorage } catch { return null } }

/** The model writes code through the backend (/v1/ai, session token), streamed by pi-ai (kernel bundle). */
function cloudWriter(assets: string, api: string, token: () => string): CodeWriter {
  type Kernel = {
    createModels(): { setProvider(p: unknown): void }
    gameApiProvider(o: { baseUrl: string; token: () => string; modelIds?: string[] }): unknown
    writeCode(o: { models: unknown; model: { provider: string; modelId: string }; system: string; user: string; temperature: number; maxTokens?: number; onText: (d: string) => void }): Promise<{ text: string }>
    GAME_PROVIDER: string; BATTLE_MODEL: string
  }
  let loading: Promise<{ k: Kernel; models: unknown }> | null = null
  const load = () => loading ??= (import(/* @vite-ignore */ assets + 'kernel/kernel.js') as Promise<Kernel>).then(k => {
    const models = k.createModels()
    models.setProvider(k.gameApiProvider({ baseUrl: api.replace(/\/$/, '') + '/v1/ai', token, modelIds: [k.BATTLE_MODEL] }))
    return { k, models }
  }).catch(e => { loading = null; throw e })
  return {
    async write(prompt, onText) {
      const { k, models } = await load()
      const { text } = await k.writeCode({ models, model: { provider: k.GAME_PROVIDER, modelId: k.BATTLE_MODEL }, system: prompt.system, user: prompt.user, temperature: prompt.temperature, maxTokens: prompt.maxTokens, onText })
      return text
    },
  }
}
