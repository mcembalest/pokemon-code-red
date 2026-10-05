import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSpeed } from './speed.ts'

function fixture() {
  const calls: string[] = []
  const speed = createSpeed({ setFastForwardRatio: r => calls.push(`ratio ${r}`), toggleFastForward: e => calls.push(`ff ${e}`) })
  return { speed, calls }
}

test('toggle turns 10x on and off', () => {
  const { speed, calls } = fixture()
  speed.toggle(); assert.equal(speed.on, true)
  speed.toggle(); assert.equal(speed.on, false)
  assert.deepEqual(calls, ['ratio 10', 'ff 1', 'ff 0'])
})

test('holding Space while toggled on does not turn it off on release', () => {
  const { speed, calls } = fixture()
  speed.toggle(); speed.hold(true); speed.hold(false)
  assert.equal(speed.on, true)
  assert.deepEqual(calls, ['ratio 10', 'ff 1'])
})

test('hold without toggle is momentary; reset clears both', () => {
  const { speed, calls } = fixture()
  speed.hold(true); speed.hold(false)
  speed.toggle(); speed.reset()
  assert.equal(speed.on, false)
  assert.deepEqual(calls, ['ratio 10', 'ff 1', 'ff 0', 'ratio 10', 'ff 1', 'ff 0'])
})
