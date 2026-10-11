import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SINE, doubtPercent, drawScan, lobeColors, natureStats, waves, W, H, TABS } from './scan.ts'
import { maxDoubt } from '../../../rules/index.mjs'

test('sine table matches FireRed (Q8.8, truncated)', () => {
  assert.equal(SINE[0], 0); assert.equal(SINE[1], 6); assert.equal(SINE[4], 25); assert.equal(SINE[64], 256); assert.equal(SINE[192], -256)
})

test('nature: up/down stats in FireRed order; the raised lobe glows brightest, the lowered dimmest', () => {
  assert.deepEqual(natureStats(3), { up: 1, down: 4 }) // ADAMANT: ATTACK up, SP. ATK down
  assert.deepEqual(natureStats(0), { up: 1, down: 1 }) // HARDY: neutral
  const sum = (c: number[]) => c[0]! + c[1]! + c[2]!
  for (let f = 0; f < 256; f += 37) {
    const c = lobeColors(3, f) // lobes: ATTACK, DEFENSE, SPEED, SP. ATK, SP. DEF; cores at even indexes
    assert.ok(sum(c[0]!) > sum(c[2]!) && sum(c[0]!) > sum(c[6]!)) // ATTACK beats DEFENSE and SP. ATK
    assert.ok(sum(c[6]!) < sum(c[2]!))                              // SP. ATK below neutral DEFENSE
  }
})

test('bond: friendship makes the wave taller and steadier; the doubt it shows is rules/doubt.mjs', () => {
  const mon = (friendship: number) => ({ personality: 1234, friendship, ivs: [0, 0, 0, 0, 0, 0], evs: [0, 0, 0, 0, 0, 0] })
  const range = (w: Int8Array) => Math.max(...w) - Math.min(...w)
  const rough = (w: Int8Array) => w.reduce((a, v, i) => a + Math.abs(v - w[(i + 1) % w.length]!), 0)
  const low = waves(mon(0), null)[0]!, high = waves(mon(255), null)[0]!
  assert.ok(range(high) > range(low) - 1 && rough(high) < rough(low))
  for (const f of [0, 70, 128, 200, 255]) assert.ok(Math.abs(doubtPercent(f) - maxDoubt(f) * 100) <= 0.5 + 1e-9, String(f))
})

test('memory: a spike for each hit, a sag for each miss; no memory → a flat trace with a little noise', () => {
  const mon = { personality: 99, friendship: 70, ivs: [31, 31, 31, 31, 31, 31], evs: [0, 0, 0, 0, 0, 0] }
  const m = waves(mon, [true, false, true])[3]!
  assert.equal(Math.max(...m.slice(0, 13)), 5)   // clamped spike (hit)
  assert.ok(Math.min(...m.slice(13, 26)) <= -3)  // sag (miss)
  assert.ok(m.slice(40).every(v => v === 0))     // nothing after the history
  assert.ok(waves(mon, null)[3]!.every(v => Math.abs(v) <= 1))
})

test('draws 168 × 88 pixels, all opaque', () => {
  const img = { data: new Uint8ClampedArray(W * H * 4), width: W, height: H } as ImageData
  const mon = { personality: 5, friendship: 70, ivs: [31, 0, 15, 7, 20, 30], evs: [0, 0, 0, 0, 0, 0] }
  drawScan(img, { mon, nature: 3, waves: waves(mon, [true]), frame: 10, tab: 'BOND' })
  for (let i = 3; i < img.data.length; i += 4) assert.equal(img.data[i], 255)
  assert.equal(TABS.length, 7)
})
