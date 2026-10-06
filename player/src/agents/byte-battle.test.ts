import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GbaMemory, fakeCore } from '../bridge/memory.ts'
import { ByteMailbox, BYTES_MAGIC } from '../bridge/battle-bytes.ts'
import { ByteBattle, type Hit, type ScriptRunner } from './byte-battle.ts'

const AT = 0x0203f4d0
const sandbox: ScriptRunner = { async run(source, json) { try { return { ok: true, value: new Function('input', source)(JSON.parse(json)) } } catch (e) { return { ok: false, error: String(e) } } } }
const names = { moveName: (id: number) => ({ 10: 'SCRATCH', 33: 'TACKLE', 999: 'WEIRD' } as Record<number, string>)[id] ?? '?', speciesName: (id: number) => ({ 4: 'CHARMANDER', 7: 'SQUIRTLE' } as Record<number, string>)[id] ?? '?', typeName: () => 'NORMAL' }

function game() {
  const core = fakeCore(), memory = new GbaMemory(core), mailbox = new ByteMailbox(memory, AT)
  // What the ROM does in Cmd_damagecalc (patches/006-byte-battles.patch).
  let id = 0
  const request = (move: number, side: 0 | 1, level = 5, attack = 11, defense = 10) => {
    memory.w32(AT + 8, ++id); memory.w32(AT + 12, 0); memory.w16(AT + 16, move); memory.w8(AT + 18, side); memory.w8(AT + 19, 0)
    memory.w16(AT + 20, move === 33 ? 35 : 40); memory.w8(AT + 22, level); memory.w8(AT + 23, 0); memory.w16(AT + 24, attack); memory.w16(AT + 26, defense)
    memory.w16(AT + 28, side ? 7 : 4); memory.w16(AT + 30, side ? 4 : 7); memory.w16(AT + 32, 19); memory.w16(AT + 34, 19); memory.w16(AT + 36, 3)
    memory.w8(AT + 6, 1)
  }
  const reply = () => ({ state: memory.u8(AT + 6), status: memory.u16(AT + 38), bytes: memory.u32(AT + 40) })
  return { core, memory, mailbox, request, reply }
}

test('host enables byte battles: magic, version, enabled', () => {
  const g = game()
  g.mailbox.enable()
  assert.equal(g.memory.u32(AT), BYTES_MAGIC); assert.equal(g.memory.u16(AT + 4), 1); assert.equal(g.memory.u8(AT + 7), 1)
  g.mailbox.enable(false); assert.equal(g.memory.u8(AT + 7), 0)
})

test('a move request runs its script; reply = output bytes; hit recorded for the target side', async () => {
  const g = game(), hits: Hit[] = []
  const bb = new ByteBattle(g.mailbox, sandbox, names, h => hits.push(h))
  await bb.poll()                       // enables
  g.request(10, 0)                      // CHARMANDER uses SCRATCH
  await bb.poll()
  assert.deepEqual(g.reply(), { state: 2, status: 0, bytes: 5 })   // floor(floor(4*40*11/10)/50)+2 = 5
  assert.deepEqual(hits[0], { side: 0, attacker: 'CHARMANDER', target: 'SQUIRTLE', move: 'SCRATCH', file: 'scratch.js', output: '/////', bytes: 5, targetHpBefore: 19 })
  assert.equal(bb.lastHit[1]?.output, '/////')
  g.memory.w8(AT + 6, 0)
  g.request(33, 1, 5, 10, 9)            // SQUIRTLE uses TACKLE
  await bb.poll()
  assert.equal(g.reply().bytes, 5)
  assert.equal(bb.lastHit[0]?.output, 'THUD ')
})

test('stale epoch is cancelled; failing script → status 1 (ROM falls back to vanilla)', async () => {
  const g = game()
  const bb = new ByteBattle(g.mailbox, { run: async () => ({ ok: false, error: 'cpu' }) }, names)
  await bb.poll()
  g.request(10, 0); await bb.poll()
  assert.deepEqual(g.reply(), { state: 2, status: 1, bytes: 0 })
  g.request(10, 0); g.memory.w32(AT + 12, 12345); await bb.poll()
  assert.equal(g.reply().state, 4)
})
