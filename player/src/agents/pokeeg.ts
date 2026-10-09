// The PokÉEG (owner, 2026-10-08): a look inside the mind of every Pokémon you own, party and PC boxes.
//   System 1, the decision brain: what picks moves (today: you; the FireRed AI for foes).
//   System 2, the code brain: the system it is (its type's data format), the readers it has learned,
//   the hot memory you pin to it (in every prompt, costs bytes), and the code it wrote lately.
// Page-side for now: the game can't open it from the PC yet; the toolbar button can.
import { FAMILIES, FORMATS, HINTS, budgetAt, contextCost, focusAt, formatOf, partyDex, stageOf } from '../../../rules/index.mjs'
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

  const renderMind = () => {
    const m = mons.find(x => x.personality === selected)
    if (!m) { mind.innerHTML = '<p class="code-red-muted">Pick a Pokémon.</p>'; return }
    const type = formatOf(m.types[0]!) as TypeName
    const fmt = FORMATS[type]
    const badges = o.badges()
    const readers = o.minds.readers(m.personality)
    const dex = partyDex({ seen: o.minds.seen(), badges })
    const hot = hotDraft?.pid === m.personality ? hotDraft.text : o.minds.hot(m.personality)
    const stage = stageOf(m.name)
    const budget = budgetAt(m.level, { stage, badges })
    const cost = contextCost({ hot: hot.trim() })
    const focus = focusAt(m.level)
    const recent = (o.minds.recent?.(m.personality) ?? []).slice().reverse()
    const chips = (xs: string[], cls = '') => xs.length ? xs.map(x => `<span class="code-red-eeg-chip ${cls}">${esc(x)}</span>`).join(' ') : '<span class="code-red-muted">none yet</span>'
    mind.innerHTML = `
      <h3>${esc(m.nickname || m.name)} <small>${esc(m.name)} · L${m.level} · ${esc(m.types.join('/'))}${m.where === 'party' ? '' : ` · box ${m.box + 1}`}</small></h3>
      <p class="code-red-eeg-system">A <b>${esc(type)}</b> system: its data arrives as <i>${esc(fmt?.note ?? 'a plain list')}</i>.<br>Its own moves are ${esc(family(type))}.</p>
      <section>
        <h4>System 1 · decision brain</h4>
        <p>You pick its moves. <span class="code-red-muted">(A trainer's Pokémon picks with FireRed's instinct; a learned decision model comes later.)</span></p>
        <p>Focus ${focus.toFixed(2)} <span class="code-red-muted">(steadier as it levels)</span> · byte budget <b>${budget}</b> <span class="code-red-muted">(L${m.level}${stage ? `, evolved ×${stage}` : ''}${badges.length ? `, ${badges.length} badge${badges.length > 1 ? 's' : ''}` : ''})</span></p>
      </section>
      <section>
        <h4>System 2 · code brain</h4>
        <p>Readers it learned: ${chips(Object.keys(readers), 'is-learned')}</p>
        <p>Pokédex readers (shared): ${chips(dex)}</p>
        <details><summary>How it reads ${esc(type)} data</summary><pre><code>${esc(HINTS[type] ?? 'const nums = data')}</code></pre></details>
        <label class="code-red-eeg-hot">Hot memory <small>(in every prompt · ${hot.trim().length} chars = ${cost} bytes off its ${budget})</small>
          <textarea data-hot rows="3" maxlength="200" placeholder="A note it always sees, e.g. “always return a plain number”">${esc(hot)}</textarea>
        </label>
        <p><button class="code-red-button" type="button" data-save-hot ${hot === o.minds.hot(m.personality) ? 'disabled' : ''}>Pin</button> <span class="code-red-muted">Comments cost bytes too: keep it short.</span></p>
        <h5>Recent code (${recent.length})</h5>
        ${recent.length ? recent.map(t => `<details class="code-red-eeg-turn" data-verdict="${t.verdict}"><summary><b>${esc(t.move)}</b> → ${esc(t.target)} · ${t.verdict === 'hit' ? 'hit' : `missed (${esc(t.reason ?? 'crashed')})`}${t.notch ? ` · ${t.notch < 0 ? 'shaken' : 'steady'} ${t.notch}` : ''} <small>${when(t.at)}</small></summary><pre><code>${esc(t.code)}</code></pre></details>`).join('') : '<p class="code-red-muted">Nothing written yet: battle, then come back.</p>'}
      </section>`
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
    const key = mons.map(m => `${m.personality}:${m.level}:${m.where}${m.box}`).join(',') + '|' + selected
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
    setVisible(on) { visible = on; element.hidden = !on; lastKey = ''; refresh() },
    select(personality) { if (selected !== personality) { selected = personality; hotDraft = null; lastKey = ''; refresh() } },
    refresh: () => { lastKey = ''; refresh() },
    dispose() { clearInterval(timer); element.remove() },
  }
}
