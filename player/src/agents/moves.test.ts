import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MOVE_SCRIPTS, scriptFor, utf8Bytes } from './moves.ts'

// Run a script the way the sandbox does: function body with `input`.
const run = (source: string, input: unknown) => new Function('input', source)(input) as string
const base = (level: number, power: number, atk: number, def: number) => Math.floor(Math.floor(Math.floor(2 * level / 5 + 2) * power * atk / def) / 50) + 2

test('damaging scripts emit exactly the Gen 3 base damage in bytes (ASCII only)', () => {
  for (const [name, power] of [['SCRATCH', 40], ['TACKLE', 35], ['POUND', 40], ['EMBER', 40], ['MEGA PUNCH', 80]] as const) {
    for (const [level, atk, def] of [[5, 11, 10], [5, 9, 12], [20, 40, 25], [50, 120, 60]] as const) {
      const out = run(scriptFor(name).source, { me: { name: 'X', level, attack: atk }, foe: { name: 'Y', defense: def, hp: 20, maxHp: 20 }, move: { name, power, type: 'NORMAL' } })
      assert.equal(utf8Bytes(out), base(level, power, atk, def), `${name} L${level}`)
      assert.equal(out.length, utf8Bytes(out), 'ASCII: 1 char = 1 byte')
    }
  }
})

test('status scripts run and are marked non-damaging', () => {
  for (const name of ['GROWL', 'TAIL WHIP']) {
    const s = MOVE_SCRIPTS[name]!
    assert.equal(s.damaging, false)
    assert.match(run(s.source, { me: { level: 5, attack: 9 }, foe: { name: 'SQUIRTLE', defense: 10 }, move: { name, power: 0 } }), /SQUIRTLE: warning/)
  }
  assert.equal(scriptFor('TACKLE').file, 'tackle.js')
  assert.equal(scriptFor('TAIL WHIP').file, 'tail_whip.js')
})
