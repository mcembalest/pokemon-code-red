// 10x speed. On while the toggle is on OR Space is held; one place decides.
export interface SpeedControls {
  setFastForwardRatio(ratio: number): void
  toggleFastForward(enabled: number): void
}

export const SPEED_RATIO = 10

export function createSpeed(fns: SpeedControls, onChange: (on: boolean, toggled: boolean) => void = () => {}) {
  let toggled = false, held = false, applied = false
  const apply = () => {
    const on = toggled || held
    if (on === applied) return
    applied = on
    if (on) fns.setFastForwardRatio(SPEED_RATIO)
    fns.toggleFastForward(on ? 1 : 0)
    onChange(on, toggled)
  }
  return {
    get on() { return toggled || held },
    get toggled() { return toggled },
    hold(value: boolean) { held = value; apply() },
    toggle() { toggled = !toggled; apply() },
    reset() { toggled = false; held = false; apply() },
  }
}
