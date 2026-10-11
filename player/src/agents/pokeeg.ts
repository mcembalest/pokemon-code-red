// The PokÉEG (owner, 2026-10-08; brain scan 2026-10-10): a look inside the mind of every Pokémon you own, party and
// PC boxes, laid out like the in-game screen (code_red_eeg.c): a brain scan (agents/scan.ts) over seven tabs.
//   NATURE, WIRING (IVs), TRAINING (EVs), BOND (friendship: how much it listens to your calls) come from FireRed itself;
//   CODE (its type's data format, budget), MEMORY (readers, last turns, recent code), NOTE (hot memory) from its code brain.
// The toolbar button opens it; the in-game PokÉEG (bedroom PC) opens it too and moves its cursor.
import { FAMILIES, FORMATS, budgetAt, contextCost, formatOf, helpersFromReaders, helpersSize, helpersSource, libCap, stageOf } from '../../../rules/index.mjs'
import { NATURES, STATS, TABS, W as SCAN_W, H as SCAN_H, channelLabels, doubtPercent, drawScan, natureStats, waves } from './scan.ts'
import type { TypeName } from '../../../rules/index.mjs'
import type { CodeMemory } from './code-battle.ts'
import type { OwnedMon } from './owned.ts'

export interface PokeegOptions {
  /** Every owned Pokémon, read from RAM (null while the game is not loaded). */
  owned: () => OwnedMon[] | null
  minds: CodeMemory
  badges: () => string[]
  onHot?: (personality: number, text: string) => void
}

export interface Pokeeg {
  element: HTMLElement
  setVisible(on: boolean): void
  readonly visible: boolean
  /** Put the cursor on this Pokémon (the in-game PokÉEG's cursor moved). */
  select(personality: number): void
  refresh(): void
  dispose(): void
}

/** The note editor the in-game PokÉEG opens ("Hot memory"): a card over the game. Resolves null on cancel. */
export function createHotEditor(host: HTMLElement, o: { pause: () => void; resume: () => void; budget?: (personality: number) => number | null }) {
  const card = document.createElement('div')
  card.className = 'code-red-hot-editor'
  card.hidden = true
  card.setAttribute('role', 'dialog')
  host.append(card)
  return {
    element: card,
    edit(personality: number, name: string, current: string, signal: AbortSignal): Promise<string | null> {
      const budget = o.budget?.(personality)
      card.innerHTML = `
        <h3>${esc(name)}'s hot memory</h3>
        <p class="code-red-muted">A note it sees in every prompt. Every character costs a byte of its budget${budget ? ` (${budget})` : ''}.</p>
        <textarea data-hot-text rows="3" maxlength="100" placeholder="e.g. always return a plain number">${esc(current)}</textarea>
        <p><small data-hot-cost></small></p>
        <p><button class="code-red-button" type="button" data-hot-pin>Pin</button> <button class="code-red-button code-red-button-quiet" type="button" data-hot-cancel>Cancel</button></p>`
      const area = card.querySelector<HTMLTextAreaElement>('[data-hot-text]')!
      const cost = card.querySelector<HTMLElement>('[data-hot-cost]')!
      const tick = () => { cost.textContent = `${area.value.trim().length} chars = ${contextCost({ hot: area.value.trim() })} bytes` }
      area.oninput = tick; tick()
      card.hidden = false
      o.pause()
      area.focus({ preventScroll: true })
      return new Promise(resolve => {
        const finish = (value: string | null) => { card.hidden = true; card.innerHTML = ''; signal.removeEventListener('abort', onAbort); o.resume(); resolve(value) }
        const onAbort = () => finish(null)
        signal.addEventListener('abort', onAbort)
        card.querySelector<HTMLButtonElement>('[data-hot-pin]')!.onclick = () => finish(area.value.trim())
        card.querySelector<HTMLButtonElement>('[data-hot-cancel]')!.onclick = () => finish(null)
        area.onkeydown = event => { if (event.key === 'Escape') finish(null); if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) finish(area.value.trim()) }
      })
    },
  }
}

const family = (type: string) => FAMILIES[(type[0] + type.slice(1).toLowerCase()) as keyof typeof FAMILIES] ?? ''
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
const when = (at: number) => { const s = Math.round((Date.now() - at) / 1000); return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago` }

export function createPokeeg(host: HTMLElement, o: PokeegOptions): Pokeeg {
  const element = document.createElement('section')
  element.className = 'code-red-eeg'
  element.hidden = true
  element.setAttribute('aria-label', 'PokÉEG')
  element.innerHTML = `
    <header><strong>PokÉEG</strong> <small>the mind of every Pokémon you own</small></header>
    <div class="code-red-eeg-body">
      <nav class="code-red-eeg-list" aria-label="Your Pokémon"></nav>
      <article class="code-red-eeg-mind"></article>
    </div>`
  host.append(element)
  const list = element.querySelector<HTMLElement>('.code-red-eeg-list')!
  const mind = element.querySelector<HTMLElement>('.code-red-eeg-mind')!
  let visible = false, selected: number | null = null, mons: OwnedMon[] = [], lastKey = ''
  let hotDraft: { pid: number; text: string } | null = null

  const renderList = () => {
    const groups = new Map<string, OwnedMon[]>()
    for (const m of mons) { const k = m.where === 'party' ? 'Party' : `Box ${m.box + 1}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(m) }
    if (!mons.length) { list.innerHTML = `<p class="code-red-muted">${o.owned() ? 'No Pokémon yet. Oak has three.' : 'Start the game to see your Pokémon.'}</p>`; return }
    list.innerHTML = [...groups].map(([k, ms]) => `<h4>${k}</h4>` + ms.map(m =>
      `<button type="button" data-pid="${m.personality}" aria-pressed="${m.personality === selected}"><b>${esc(m.nickname || m.name)}</b> <small>${m.nickname && m.nickname !== m.name ? esc(m.name) + ' · ' : ''}L${m.level} · ${esc(m.types.join('/'))}</small></button>`).join('')).join('')
  }

  // The brain scan (agents/scan.ts): the same picture as the in-game screen, animated while the panel is open.
  let tab: (typeof TABS)[number] = 'NATURE', frame = 0, raf = 0
  let scan: { canvas: HTMLCanvasElement; img: ImageData; mon: OwnedMon; waves: Int8Array[] } | null = null
  const tick = () => {
    raf = 0
    if (!visible || !scan || !scan.canvas.isConnected) return
    frame++
    drawScan(scan.img, { mon: scan.mon, nature: scan.mon.nature, waves: scan.waves, frame, tab })
    scan.canvas.getContext('2d')!.putImageData(scan.img, 0, 0)
    raf = requestAnimationFrame(tick)
  }
  const animate = () => { if (!raf && visible) raf = requestAnimationFrame(tick) }

  const renderMind = () => {
    const m = mons.find(x => x.personality === selected)
    if (!m) { mind.innerHTML = '<p class="code-red-muted">Pick a Pokémon.</p>'; scan = null; return }
    const type = formatOf(m.types[0]!) as TypeName
    const fmt = FORMATS[type]
    const badges = o.badges()
    const lib = o.minds.lib(m.personality)
    const libShown = lib.length ? lib : helpersFromReaders(o.minds.readers(m.personality))
    const cap = libCap(m.level), libBytes = helpersSize(libShown)
    const hot = hotDraft?.pid === m.personality ? hotDraft.text : o.minds.hot(m.personality)
    const stage = stageOf(m.name)
    const budget = budgetAt(m.level, { stage, badges })
    const cost = contextCost({ hot: hot.trim() })
    const recent = (o.minds.recent?.(m.personality) ?? []).slice().reverse()
    const last = (o.minds.recent?.(m.personality) ?? []).slice(-10)
    const chips = (xs: string[], cls = '') => xs.length ? xs.map(x => `<span class="code-red-eeg-chip ${cls}">${esc(x)}</span>`).join(' ') : '<span class="code-red-muted">none yet</span>'
    const { up, down } = natureStats(m.nature)
    const stats = (v: number[]) => `<p class="code-red-eeg-stats">${STATS.map((n, i) => `<span>${n} <b>${v[i] ?? 0}</b></span>`).join('')}</p>`
    const doubt = doubtPercent(m.friendship)
    const hits = last.filter(t => t.verdict === 'hit').length
    const body: Record<(typeof TABS)[number], string> = {
      NATURE: `<p><b>${NATURES[m.nature]}</b> nature</p>` + (up === down
        ? '<p>Raises and lowers nothing: every lobe glows alike.</p>'
        : `<p>Raises ${STATS[up]}: its lobe glows.</p><p>Lowers ${STATS[down]}: its lobe dims.</p>`),
      WIRING: `<p>Wiring (IVs), set at birth:</p>${stats(m.ivs)}<p class="code-red-muted">Each pair of electrodes is one stat; the better its IV, the brighter.</p>`,
      TRAINING: `<p>Training (EVs): <b>${m.evs.reduce((a, b) => a + b, 0)}</b> of 510</p>${stats(m.evs)}`,
      BOND: `<p>Friendship: <b>${m.friendship}</b> of 255</p><p>Instinct: whatever hits hardest.</p><p>${doubt ? `Doubts your calls: up to <b>${doubt}%</b>` : 'Never doubts your calls.'}</p>
        <p class="code-red-muted">When your call looks weaker to its instinct, it may use its own pick instead. The closer you are, the less it doubts you.</p>`,
      CODE: `<p><b>${esc(type)}</b> system</p><p>Data arrives as: <i>${esc(fmt?.short ?? 'plain list')}</i> <span class="code-red-muted">(${esc(fmt?.note ?? 'a plain list')})</span></p>
        <p>Budget: <b>${budget}</b> bytes a turn <span class="code-red-muted">(L${m.level}${stage ? `, evolved ×${stage}` : ''}${badges.length ? `, ${badges.length} badge${badges.length > 1 ? 's' : ''}` : ''})</span></p>
        <p class="code-red-muted">Its own moves are ${esc(family(type))}.</p>`,
      MEMORY: `<p>Long-term memory: <b>${libBytes}</b> of ${cap} bytes ${chips(libShown.map(h => h.name), 'is-learned')}</p>${libShown.length ? `<pre><code>${esc(helpersSource(libShown))}</code></pre>` : ''}<p class="code-red-muted">Code it wrote and chose to keep. In battle it keeps my… helpers for the rest of the fight; when the battle ends it rewrites what it keeps to fit, and can forget. Anything else it reads by instinct.</p>
        <p>${last.length ? `Last ${last.length} turns: ${hits} hit, ${last.length - hits} miss` : 'No code written yet.'}</p>
        <h5>Recent code (${recent.length})</h5>
        ${recent.length ? recent.map(t => `<details class="code-red-eeg-turn" data-verdict="${t.verdict}"><summary><b>${esc(t.move)}</b> → ${esc(t.target)} · ${t.verdict === 'hit' ? 'hit' : `missed (${esc(t.reason ?? 'crashed')})`}${t.notch ? ` · ${t.notch < 0 ? 'shaken' : 'steady'} ${t.notch}` : ''} <small>${when(t.at)}</small></summary><pre><code>${esc(t.code)}</code></pre></details>`).join('') : '<p class="code-red-muted">Nothing written yet: battle, then come back.</p>'}`,
      NOTE: `<label class="code-red-eeg-hot">Hot memory <small>(in every prompt · ${hot.trim().length} chars = ${cost} bytes off its ${budget})</small>
          <textarea data-hot rows="3" maxlength="200" placeholder="A note it always sees, e.g. “always return a plain number”">${esc(hot)}</textarea>
        </label>
        <p><button class="code-red-button" type="button" data-save-hot ${hot === o.minds.hot(m.personality) ? 'disabled' : ''}>Pin</button> <span class="code-red-muted">Comments cost bytes too: keep it short.</span></p>`,
    }
    mind.innerHTML = `
      <h3>${esc(m.nickname || m.name)} <small>${esc(m.name)} · L${m.level} · ${esc(m.types.join('/'))}${m.where === 'party' ? ' · party' : ` · box ${m.box + 1}`}</small></h3>
      <div class="code-red-eeg-scan">
        <canvas width="${SCAN_W}" height="${SCAN_H}" aria-label="Brain scan of ${esc(m.nickname || m.name)}"></canvas>
        ${channelLabels().map(l => `<span data-channel="${l.tab}" style="left:${(l.x / SCAN_W) * 100}%;top:${(l.y / SCAN_H) * 100}%">${l.name}</span>`).join('')}
      </div>
      <div class="code-red-eeg-tabs" role="tablist">${TABS.map(t => `<button type="button" role="tab" data-tab="${t}" aria-selected="${t === tab}">${t}</button>`).join('')}</div>
      ${TABS.map(t => `<section class="code-red-eeg-tab" data-panel="${t}" ${t === tab ? '' : 'hidden'}>${body[t]}</section>`).join('')}`
    const canvas = mind.querySelector('canvas')!
    scan = { canvas, img: canvas.getContext('2d')!.createImageData(SCAN_W, SCAN_H), mon: m, waves: waves(m, last.map(t => t.verdict === 'hit')) }
    const showTab = () => {
      mind.querySelectorAll<HTMLElement>('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== tab })
      mind.querySelectorAll<HTMLElement>('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)))
      mind.querySelectorAll<HTMLElement>('[data-channel]').forEach(l => l.classList.toggle('is-on', l.dataset.channel === tab))
    }
    showTab()
    const tabs = mind.querySelector<HTMLElement>('.code-red-eeg-tabs')!
    tabs.onclick = event => { const b = (event.target as HTMLElement).closest<HTMLElement>('[data-tab]'); if (b) { tab = b.dataset.tab as typeof tab; showTab() } }
    tabs.onkeydown = event => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
      tab = TABS[(TABS.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]!
      showTab(); tabs.querySelector<HTMLElement>(`[data-tab="${tab}"]`)!.focus()
    }
    animate()
    const area = mind.querySelector<HTMLTextAreaElement>('[data-hot]')!
    const save = mind.querySelector<HTMLButtonElement>('[data-save-hot]')!
    area.oninput = () => {
      hotDraft = { pid: m.personality, text: area.value }
      save.disabled = area.value === o.minds.hot(m.personality)
      const label = mind.querySelector<HTMLElement>('.code-red-eeg-hot small')!
      label.textContent = `(in every prompt · ${area.value.trim().length} chars = ${contextCost({ hot: area.value.trim() })} bytes off its ${budget})`
    }
    save.onclick = () => { o.minds.setHot(m.personality, area.value); o.onHot?.(m.personality, area.value); hotDraft = null; renderMind() }
  }

  const refresh = () => {
    if (!visible) return
    mons = o.owned() ?? []
    if (selected === null && mons.length) selected = mons[0]!.personality
    const key = mons.map(m => `${m.personality}:${m.level}:${m.where}${m.box}:${m.friendship}:${m.evs.join('.')}`).join(',') + '|' + selected
    if (key !== lastKey) { lastKey = key; renderList(); renderMind() }
  }
  list.onclick = event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-pid]')
    if (!button) return
    selected = Number(button.dataset.pid)
    hotDraft = null
    lastKey = ''
    refresh()
  }
  const timer = setInterval(refresh, 2000)
  return {
    element,
    get visible() { return visible },
    setVisible(on) { visible = on; element.hidden = !on; lastKey = ''; refresh(); animate() },
    select(personality) { if (selected !== personality) { selected = personality; hotDraft = null; lastKey = ''; refresh() } },
    refresh: () => { lastKey = ''; refresh() },
    dispose() { clearInterval(timer); if (raf) cancelAnimationFrame(raf); element.remove() },
  }
}
