import './repl.css'

export type ReplResult = { ok: true; value: unknown } | { ok: false; error: string }
export interface ReplRunner {
  run(source: string, inputJSON: string): Promise<ReplResult>
  cancel(): void
  dispose(): void
}
export interface ReplOptions {
  runner: ReplRunner
  onClose(lastNumeric?: number): void
  onBusy?(busy: boolean): void
}

/** The supplied runner owns the bounded worker/VM; this UI never evaluates code. */
export function createRepl({ runner, onClose, onBusy }: ReplOptions) {
  const dialog = document.createElement('dialog')
  dialog.className = 'code-red-repl'
  dialog.setAttribute('aria-label', 'JavaScript scratchpad')
  dialog.innerHTML = `<div class="code-red-repl-heading"><h2>JavaScript scratchpad</h2><button type="button" data-repl-close>Close</button></div>
    <p>Each Run starts a fresh JavaScript environment. Variables do not carry over. This transcript lasts until you close the console.</p>
    <pre data-repl-input aria-label="Current input"></pre>
    <label>Code mode <select data-repl-mode><option value="expression">Expression</option><option value="statements">Statements with return</option></select></label>
    <label class="code-red-repl-editor">JavaScript<textarea data-repl-source rows="5" maxlength="8192" inputmode="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"></textarea></label>
    <p class="code-red-repl-hint">Enter runs · Shift+Enter adds a line · Escape closes. Return an integer from 0 to 1530 to send a calculation back to the game on Close.</p>
    <div class="code-red-repl-actions"><button type="button" data-repl-run>Run</button><button type="button" data-repl-cancel disabled>Cancel run</button><span data-repl-status role="status"></span></div>
    <div data-repl-transcript role="log" aria-label="Calculation transcript" aria-live="polite"></div>`
  const source = dialog.querySelector<HTMLTextAreaElement>('[data-repl-source]')!
  const mode = dialog.querySelector<HTMLSelectElement>('[data-repl-mode]')!
  const runButton = dialog.querySelector<HTMLButtonElement>('[data-repl-run]')!
  const cancelButton = dialog.querySelector<HTMLButtonElement>('[data-repl-cancel]')!
  const transcript = dialog.querySelector<HTMLElement>('[data-repl-transcript]')!
  const status = dialog.querySelector<HTMLElement>('[data-repl-status]')!
  let generation = 0, submission = 0, busy = false, disposed = false
  let inputJSON = '', token: unknown, lastNumeric: number | undefined
  let previousFocus: HTMLElement | null = null
  document.body.appendChild(dialog)

  function setBusy(value: boolean) {
    if (busy !== value) { busy = value; onBusy?.(value) }
    runButton.disabled = value
    cancelButton.disabled = !value
    status.textContent = value ? 'Running…' : ''
  }
  function append(code: string, output: string) {
    const entry = document.createElement('div')
    const command = document.createElement('pre'), result = document.createElement('pre')
    command.textContent = `> ${code.slice(0, 8192)}`
    result.textContent = output
    entry.append(command, result)
    transcript.appendChild(entry)
    while (transcript.children.length > 20) transcript.firstElementChild!.remove()
    entry.scrollIntoView({ block: 'nearest' })
  }
  function cancel() {
    if (!busy) return
    submission++
    runner.cancel()
    setBusy(false)
    append('', 'Cancelled.')
  }
  async function run() {
    if (!dialog.open || busy || disposed) return
    const code = source.value.trim()
    if (!code) { status.textContent = 'Enter a calculation first.'; return }
    const body = mode.value === 'expression' ? `return (\n${code}\n);` : code
    const session = generation, request = ++submission, requestToken = token
    setBusy(true)
    try {
      const result = await runner.run(body, inputJSON)
      if (disposed || !dialog.open || session !== generation || request !== submission || requestToken !== token) return
      if (result.ok) {
        const formatted = JSON.stringify(result.value, null, 2)
        append(code, formatted === undefined ? 'No JSON result.' : formatted)
        if (typeof result.value === 'number' && Number.isInteger(result.value) && result.value >= 0 && result.value <= 1530) lastNumeric = result.value
      } else append(code, `Error: ${result.error}`)
    } catch {
      if (disposed || !dialog.open || session !== generation || request !== submission || requestToken !== token) return
      append(code, 'Error: calculation could not run.')
    } finally {
      if (session === generation && request === submission) setBusy(false)
    }
  }
  function close() {
    if (!dialog.open) return
    generation++; submission++
    runner.cancel()
    setBusy(false)
    const value = lastNumeric
    lastNumeric = undefined
    transcript.replaceChildren()
    dialog.close()
    previousFocus?.focus({ preventScroll: true })
    onClose(value)
  }
  dialog.addEventListener('keydown', event => {
    event.stopPropagation()
    if (event.isComposing) return
    if (event.key === 'Escape') { event.preventDefault(); close() }
    else if (event.key === 'Enter' && event.target === source && !event.shiftKey) { event.preventDefault(); if (!event.repeat) void run() }
  }, true)
  dialog.addEventListener('keyup', event => event.stopPropagation(), true)
  dialog.addEventListener('cancel', event => { event.preventDefault(); close() })
  runButton.onclick = () => { void run() }
  cancelButton.onclick = cancel
  dialog.querySelector<HTMLButtonElement>('[data-repl-close]')!.onclick = close
  return {
    open(stats: readonly number[], nextToken: unknown) {
      if (disposed) return
      generation++; submission++
      runner.cancel(); setBusy(false)
      token = nextToken; lastNumeric = undefined
      inputJSON = JSON.stringify({ stats: [...stats] })
      dialog.querySelector<HTMLElement>('[data-repl-input]')!.textContent = `input = ${inputJSON}`
      transcript.replaceChildren()
      source.value = 'input.stats.reduce((sum, n) => sum + n, 0)'
      mode.value = 'expression'
      if (!dialog.open) { previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null; dialog.showModal() }
      source.focus({ preventScroll: true })
    },
    close,
    dispose() {
      if (disposed) return
      disposed = true; generation++; submission++
      runner.cancel(); setBusy(false)
      if (dialog.open) dialog.close()
      dialog.remove(); runner.dispose()
    },
  }
}
