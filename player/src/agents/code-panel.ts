// The code panel (owner, 2026-10-08): under the game on phones, beside it on wide screens.
// Foe's code on top, yours below, both streaming as they're written; a toggle hides it.
// The first battles replay the code at a readable pace (~2 s); later it shows at real speed;
// the 10× speed-up shows it at once.
import type { Panel, TurnInfo, TurnResult } from './code-battle.ts'

const READABLE_BATTLE_TURNS = 12   // turns shown at a readable pace before real speed
const READABLE_MS = 2000           // how long a whole block takes to appear at readable pace
const HOLD_MS = 700                // verdict stays up before the game moves on

interface Pane { root: HTMLElement; head: HTMLElement; code: HTMLElement; foot: HTMLElement; queue: string; shown: number; info: TurnInfo | null }

export interface CodePanel extends Panel {
  element: HTMLElement
  setVisible(on: boolean): void
  readonly visible: boolean
  dispose(): void
}

const describe = (i: TurnInfo) => {
  const who = i.side === 1 ? `${i.wild ? 'Wild' : 'Foe'} ${i.attacker}` : i.attacker
  const data = i.tutorial ? 'a plain list' : `${i.type} data`
  const knows = i.know === 'dex' ? ' · Pokédex reader' : i.know === 'memory' ? ' · remembers this type' : ''
  const mood = i.doubt ? ` · doubts you ${i.doubt.notch}${i.doubt.wanted ? ` (wanted ${i.doubt.wanted})` : ''}` : i.notch < 0 ? ` · shaken ${i.notch}` : i.notch > 0 ? ` · steady +${i.notch}` : ''
  const makes = i.makes === 'sound' ? ' · makes a sound' : i.makes === 'image' ? ' · draws a picture' : ''
  const room = i.memoryCost ? `≤${i.budget - i.memoryCost} chars (${i.budget} − ${i.memoryCost} memory)` : `≤${i.budget} chars`
  return { who, line: `${i.move} → ${data}${knows}${mood}${makes} · ${room}` }
}

export function createCodePanel(host: HTMLElement, options: { fast?: () => boolean; now?: () => number; wait?: (ms: number) => Promise<void> } = {}): CodePanel {
  const fast = options.fast ?? (() => false)
  const now = options.now ?? (() => performance.now())
  const wait = options.wait ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)))
  const element = document.createElement('section')
  element.className = 'code-red-code'
  element.setAttribute('aria-label', 'Battle code')
  const pane = (label: string): Pane => {
    const root = document.createElement('div')
    root.className = 'code-red-code-pane'
    root.dataset.side = label
    root.innerHTML = '<header></header><pre><code></code></pre><footer></footer>'
    element.append(root)
    const head = root.querySelector('header')!, code = root.querySelector('code')!, foot = root.querySelector('footer')!
    head.textContent = label === 'foe' ? 'Foe' : 'You'
    return { root, head, code, foot, queue: '', shown: 0, info: null }
  }
  const panes = [pane('you'), pane('foe')] as const
  element.append(panes[1].root, panes[0].root) // foe on top
  host.append(element)
  let turns = 0, visible = true

  // Show the code, not the reply's fence lines (```js … ```).
  const render = (p: Pane) => { p.code.textContent = p.queue.slice(0, p.shown).replace(/^\s*```[a-z]*[ \t]*\n?/i, '').replace(/\n?```\s*$/, '') }

  return {
    element,
    get visible() { return visible },
    setVisible(on) { visible = on; element.hidden = !on },
    begin(info) {
      const p = panes[info.side]
      p.info = info; p.queue = ''; p.shown = 0
      const d = describe(info)
      p.head.innerHTML = ''
      const strong = document.createElement('strong'); strong.textContent = d.who
      const small = document.createElement('small'); small.textContent = d.line
      p.head.append(strong, ' ', small)
      p.foot.textContent = 'writing…'
      p.root.dataset.state = 'writing'
      render(p)
    },
    text(side, delta) {
      const p = panes[side]
      p.queue += delta
      if (fast() || !visible || turns >= READABLE_BATTLE_TURNS) { p.shown = p.queue.length; render(p) }
    },
    async end(side, result: TurnResult) {
      const p = panes[side]
      // Readable pace: reveal what's left over READABLE_MS (early battles), at most ~60 fps.
      if (!fast() && visible && turns < READABLE_BATTLE_TURNS) {
        const from = p.shown, total = p.queue.length, start = now()
        while (p.shown < total) {
          await wait(16)
          if (fast()) break
          p.shown = Math.min(total, from + Math.ceil((total - from) * Math.min(1, (now() - start) / READABLE_MS)))
          render(p)
        }
      }
      p.shown = p.queue.length; render(p)
      turns++
      p.root.dataset.state = result.verdict
      p.foot.textContent = result.detail ? `${result.text} (${result.detail})` : result.text
      if (!fast() && visible) await wait(HOLD_MS)
    },
    dispose() { element.remove() },
  }
}
