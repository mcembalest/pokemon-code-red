export interface GameInput {
  simulateInput(player: number, index: number, value: number): void
  functions: { setFastForwardRatio(ratio: number): void; toggleFastForward(enabled: number): void }
}
const arrows: Record<string, number> = { ArrowUp: 4, ArrowDown: 5, ArrowLeft: 6, ArrowRight: 7 }
const editing = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('input, textarea, select, button, a, [contenteditable], [role="textbox"]'))

export function bindGameKeyboard(game: HTMLElement, gm: GameInput, epochOf: () => number, menuOpen: () => boolean = () => false) {
  let focused = false, speeding = false, disposed = false
  let epoch = epochOf()
  const held = new Set<number>()
  const simulate = gm.simulateInput
  const wrapped = (player: number, index: number, value: number) => {
    if (player === 0 && index >= 0 && index < 16) value ? held.add(index) : held.delete(index)
    simulate.call(gm, player, index, value)
  }
  gm.simulateInput = wrapped
  const release = () => {
    if (speeding) gm.functions.toggleFastForward(0)
    speeding = false
    for (const index of held) simulate.call(gm, 0, index, 0)
    held.clear()
  }
  const pointer = (event: PointerEvent) => {
    if (!game.contains(event.target as Node) || editing(event.target)) {
      focused = false; release()
      if (!game.contains(event.target as Node) && game.contains(document.activeElement)) (document.activeElement as HTMLElement).blur()
    } else {
      focused = true
      game.focus({ preventScroll: true })
    }
  }
  const focus = () => {
    focused = game.contains(document.activeElement) && !editing(document.activeElement)
    if (!focused) release()
  }
  const key = (event: KeyboardEvent) => {
    if (menuOpen()) { release(); return }
    if (editing(event.target) || !focused || event.ctrlKey || event.metaKey || event.altKey) {
      // EmulatorJS listens on the game element; let forms keep their own keys.
      if (editing(event.target)) event.stopPropagation()
      return
    }
    const index = arrows[event.code]
    if (event.code !== 'Space' && index === undefined) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.code === 'Space') {
      if (event.type === 'keyup') { if (speeding) gm.functions.toggleFastForward(0); speeding = false }
      else if (!event.repeat && !speeding) { gm.functions.setFastForwardRatio(10); gm.functions.toggleFastForward(1); speeding = true }
    } else if (event.type === 'keyup') gm.simulateInput(0, index!, 0)
    else if (!event.repeat) gm.simulateInput(0, index!, 1)
  }
  const up = (event: KeyboardEvent) => { if (event.code === 'Space' && speeding) { gm.functions.toggleFastForward(0); speeding = false } }
  const blur = () => { focused = false; release() }
  const hide = () => { if (document.hidden) blur() }
  const restore = () => { if (!document.hidden) focus() }
  game.tabIndex = 0
  window.addEventListener('pointerdown', pointer, true)
  document.addEventListener('focusin', focus)
  game.addEventListener('focusout', focus)
  game.addEventListener('keydown', key, true)
  game.addEventListener('keyup', key, true)
  window.addEventListener('keyup', up, true)
  window.addEventListener('blur', blur)
  window.addEventListener('focus', restore)
  window.addEventListener('pageshow', restore)
  window.addEventListener('pagehide', blur)
  document.addEventListener('visibilitychange', hide)
  document.addEventListener('visibilitychange', restore)
  const timer = setInterval(() => { const now = epochOf(); if (now !== epoch) { epoch = now; release() } }, 16)
  return { release, dispose() {
    if (disposed) return
    disposed = true; clearInterval(timer); release()
    if (gm.simulateInput === wrapped) gm.simulateInput = simulate
    window.removeEventListener('pointerdown', pointer, true)
    document.removeEventListener('focusin', focus)
    game.removeEventListener('focusout', focus)
    game.removeEventListener('keydown', key, true)
    game.removeEventListener('keyup', key, true)
    window.removeEventListener('keyup', up, true)
    window.removeEventListener('blur', blur)
    window.removeEventListener('focus', restore)
    window.removeEventListener('pageshow', restore)
    window.removeEventListener('pagehide', blur)
    document.removeEventListener('visibilitychange', hide)
    document.removeEventListener('visibilitychange', restore)
  } }
}
