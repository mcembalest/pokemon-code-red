import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MOVES, FORMATS, judge, extractCode, rng, targetBytes } from '../../../rules/index.mjs'
import { mockWriter } from './code-battle.ts'

const runSource = async (source: string) => { try { return { ok: true, value: new Function(source)() } } catch (e) { return { ok: false, error: String(e) } } }

test('stand-in model: right code for every move and format when it means to be right', async () => {
  const w = mockWriter({ missEvery: 1e9, delay: async () => {} }), r = rng(5)
  for (const move of MOVES) for (const type of ['WATER', 'FIRE', 'PSYCHIC'] as const) {
    const bytes = targetBytes(r), data = FORMATS[type].encode(bytes)
    const text = await w.write({ system: '', user: '', temperature: 0, meta: { move, type, tutorial: false } }, () => {})
    const v = await judge({ move, bytes, data, code: extractCode(text).code, budget: 999, runSource })
    assert.equal(v.hit, true, `${move.name} ${type}\n${text}\n${JSON.stringify(v)}`)
  }
})
