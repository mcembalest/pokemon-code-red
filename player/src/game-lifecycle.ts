type Command = (...args: unknown[]) => unknown
export interface LifecycleGame { functions: Record<string, Command> }

// EmulatorJS processes these commands in its frame loop. A paused console must
// release its pause before a load/reset/rewind can invalidate the core epoch.
export function bindGameLifecycle(game: LifecycleGame, before: () => void) {
  const hooks: { name: string; original: Command; wrapped: Command }[] = []
  for (const name of ['loadState', 'restart', 'toggleRewind']) {
    const original = game.functions[name]
    if (typeof original !== 'function') continue
    const wrapped: Command = (...args) => {
      if (name !== 'toggleRewind' || args[0] === 1) before()
      return original.apply(game.functions, args)
    }
    hooks.push({ name, original, wrapped })
    game.functions[name] = wrapped
  }
  return { dispose() {
    for (const { name, original, wrapped } of hooks) if (game.functions[name] === wrapped) game.functions[name] = original
  } }
}
