// The player uses the shared battle rules (../rules): import + types resolve, the prompt builds.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { byFireRed, budgetAt, turnPrompt } from '../../rules/index.mjs'

test('player sees the shared rules', () => {
  const move = byFireRed('SCRATCH')
  assert.ok(move)
  const p = turnPrompt({ self: { name: 'CHARMANDER', level: 5 }, target: { name: 'SQUIRTLE', level: 5, types: ['WATER'] }, move, type: 'WATER', budget: budgetAt(5) })
  assert.match(p.user, /function slice\(data\)/)
})
