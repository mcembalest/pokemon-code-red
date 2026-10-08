// First agent moment: while Oak asks "So! You want ___?" in the lab, show the
// starter as a coding agent: its persona and the moves it knows, as the code each one asks for.
import { byFireRed } from '../../../rules/index.mjs'
import { STARTERS } from './moves.ts'

export interface LabMemory { u8(a: number): number; u16(a: number): number; u32(a: number): number }

const TASK_SIZE = 40, NUM_TASKS = 16
const SB1_LOCATION = 0x004, SB1_VARS = 0x1000, VAR_TEMP_2 = 0x4002
const LAB = [4, 3] // MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB

/** Species shown by the lab's showmonpic (VAR_TEMP_2 = PLAYER_STARTER_SPECIES), or null. */
export function offeredStarter(mem: LabMemory, sym: { gTasks: number; monPicTask: number; saveBlock1Ptr: number }): number | null {
  try {
    let shown = false
    for (let i = 0; i < NUM_TASKS; i++) {
      const t = sym.gTasks + i * TASK_SIZE
      if (mem.u8(t + 4) && (mem.u32(t) & ~1) === (sym.monPicTask & ~1)) { shown = true; break }
    }
    if (!shown) return null
    const sb1 = mem.u32(sym.saveBlock1Ptr)
    if (sb1 < 0x02000000 || sb1 >= 0x02040000) return null
    if (mem.u8(sb1 + SB1_LOCATION) !== LAB[0] || mem.u8(sb1 + SB1_LOCATION + 1) !== LAB[1]) return null
    const species = mem.u16(sb1 + SB1_VARS + (VAR_TEMP_2 - 0x4000) * 2)
    return species in STARTERS ? species : null
  } catch { return null }
}

export function starterCardHtml(species: number): string {
  const s = STARTERS[species]!
  const esc = (t: string) => t.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))
  const moves = s.moves.map(m => {
    const move = byFireRed(m)
    return move ? `<li><b>▶ ${esc(move.name)}</b> <span>${esc(`function ${move.fn}(data)`)}</span><small>returns ${esc(move.spec)}</small></li>` : ''
  }).join('')
  return `<div class="code-red-card-head">${esc(s.name)} <span>coding agent</span></div>
<p>${esc(s.persona)}</p>
<p class="code-red-card-sub">Knows ${s.moves.length} moves:</p>
<ul>${moves}</ul>
<p class="code-red-card-sub">Call a move and ${esc(s.name)} writes it in JavaScript. The game runs it on the foe's data: the right answer hits.</p>`
}

export function createStarterCard(host: HTMLElement, read: () => number | null, onShow: (species: number) => void = () => {}) {
  const card = document.createElement('div')
  card.className = 'code-red-agent-card'
  card.dataset.starterCard = ''
  card.hidden = true
  host.appendChild(card)
  let current: number | null = null
  const timer = setInterval(() => {
    const species = read()
    if (species === current) return
    current = species
    card.hidden = species === null
    if (species !== null) { card.innerHTML = starterCardHtml(species); card.dataset.species = String(species); onShow(species) }
  }, 200)
  return { element: card, dispose() { clearInterval(timer); card.remove() } }
}
