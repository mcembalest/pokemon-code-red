import type { NamingMailbox } from './bridge/naming.ts'

/** Native naming screens accept typed text through the fixed naming mailbox. Typing goes straight into the game's
 *  own naming screen, letter by letter, with nothing on the page moving (playtest 1, 2026-10-12). Keyboard only:
 *  phones are not supported (owner, 2026-10-12), so there is no on-page text form. */
export function bindGameText(game: HTMLElement, naming: NamingMailbox, epochOf: () => number, release: () => void, blocked: () => boolean = () => false) {
  let epoch = 0, session = 0, sequence = 0, lastSent = 0, active = false, confirming = false, disposed = false
  let text = '', maxLength = 0
  const valid = (value: string) => /^[A-Za-z0-9 .,!?/\-'" ]*$/.test(value) && value.length <= maxLength
  const send = (action: 1 | 2, value = text) => {
    if (!active || !valid(value)) return false
    const next = ++sequence
    const accepted = naming.write(epoch, session, next, action, value)
    if (accepted) lastSent = next
    else confirming = false
    return Boolean(accepted)
  }
  const key = (event: KeyboardEvent) => {
    if (blocked() || (event.target instanceof Element && event.target.closest('input, textarea, select, button, a, [contenteditable], [role="textbox"]')) || !active || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || !game.contains(document.activeElement)) return
    if (event.key.length !== 1 && event.key !== 'Backspace' && event.key !== 'Enter') return
    event.preventDefault(); event.stopImmediatePropagation(); release() // keep the keyboard on the game; the letters appear on the naming screen
    if (event.key === 'Enter') { if (send(1)) confirming = true }
    else if (event.key === 'Backspace') { text = text.slice(0, -1); send(1) }
    else if (text.length < maxLength && valid(text + event.key)) { text += event.key; send(1) }
  }
  game.addEventListener('keydown', key, true)
  const poll = () => {
    if (disposed) return
    if (document.hidden) { confirming = false; return }
    const now = epochOf()
    const state = naming.snapshot()
    if (!state) {
      active = false; confirming = false
      delete game.dataset.naming
      return
    }
    const next = state.session, ack = state.ackSequence
    if (!active || now !== epoch || next !== session) {
      epoch = now; session = next; sequence = Math.max(ack, state.sequence); lastSent = ack
      confirming = false
      maxLength = state.maxLength
      text = state.current
      active = true
      game.dataset.naming = '' // tests and tools can see a naming screen is up
      if (!blocked()) release()
    } else if (ack >= lastSent && !confirming) {
      text = state.current
    }
    if (confirming && ack >= lastSent && state.action === 0) { confirming = false; send(2) }
  }
  const leave = () => { confirming = false; if (active) send(1); release() }
  const hide = () => { if (document.hidden) leave() }
  document.addEventListener('visibilitychange', hide)
  window.addEventListener('pagehide', leave)
  window.addEventListener('blur', leave)
  const timer = setInterval(poll, 16)
  poll()
  return { dispose() {
    if (disposed) return
    disposed = true; clearInterval(timer); document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', leave); window.removeEventListener('blur', leave); game.removeEventListener('keydown', key, true)
  } }
}
