import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GbaMemory, fakeCore } from './memory.ts'
import { PAYLOAD_MAGIC, PayloadMailbox, packImage, packSound } from './payload.ts'

test('packImage: 1024 pixels → 512 bytes of 4bpp tiles in 1D 32×32 order, 16 shades', () => {
  const px = new Array(1024).fill(255)
  px[0] = 0; px[1] = 128 // first two pixels of tile 0: black (shade 1) then mid grey (shade 8)
  px[8] = 0 // pixel (x=8, y=0) starts tile 1
  px[32 * 8] = 0 // pixel (x=0, y=8) starts tile 4
  const t = packImage(px)
  assert.equal(t.length, 512)
  assert.equal(t[0], 0x81) // low nibble = x even (shade 1), high nibble = x odd (shade 8); 0 is transparent
  assert.equal(t[1], 0xFF)
  assert.equal(t[32], 0xF1); assert.equal(t[4 * 32], 0xF1)
})

test('packSound: unsigned around 128 → signed 8-bit, clipped to 512 samples', () => {
  assert.deepEqual([...packSound([128, 255, 0, 200])], [0, 127, 0x80, 72])
  assert.equal(packSound(new Array(700).fill(128)).length, 512)
})

test('mailbox: deliver publishes kind last; played counts what the game took', () => {
  const memory = new GbaMemory(fakeCore()), AT = 0x02021000
  const box = new PayloadMailbox(memory, AT)
  assert.ok(box.deliver('sound', [4, ...new Array(399).fill(230)]))
  assert.equal(memory.u32(AT), PAYLOAD_MAGIC); assert.equal(memory.u16(AT + 4), 1); assert.equal(memory.u8(AT + 6), 1); assert.equal(memory.u16(AT + 8), 400)
  assert.equal((memory.u8(AT + 28) << 24) >> 24, 4 - 128)
  assert.equal(box.played(), 0)
  memory.w8(AT + 6, 0); memory.w16(AT + 10, 1) // the game played it
  assert.equal(box.played(), 1)
  assert.ok(box.deliver('image', new Array(1024).fill(255)))
  assert.equal(memory.u8(AT + 6), 2); assert.equal(memory.u16(AT + 8), 512); assert.equal(memory.u8(AT + 28), 0xFF)
})
