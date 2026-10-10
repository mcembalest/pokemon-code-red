import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GbaMemory, fakeCore } from './memory.ts'
import { PAYLOAD_MAGIC, PayloadMailbox, bgr555, packImage, packSound } from './payload.ts'

test('packImage: color numbers → 4bpp tiles, 512 bytes a frame, in 1D 32×32 order; up to 4 frames', () => {
  const px = new Array(2048).fill(0)
  px[0] = 1; px[1] = 8 // first two pixels of frame 1, tile 0
  px[8] = 15 // pixel (x=8, y=0) starts tile 1
  px[32 * 8] = 3 // pixel (x=0, y=8) starts tile 4
  px[1024] = 5 // frame 2 starts at byte 512
  const { tiles, frames } = packImage(px)
  assert.equal(frames, 2); assert.equal(tiles.length, 1024)
  assert.equal(tiles[0], 0x81) // low nibble = x even, high nibble = x odd
  assert.equal(tiles[32], 0x0F); assert.equal(tiles[4 * 32], 0x03); assert.equal(tiles[512], 0x05)
  assert.equal(packImage(new Array(9000).fill(1)).frames, 4)
})

test('packSound: unsigned around 128 → signed 8-bit, clipped to 4096 samples', () => {
  assert.deepEqual([...packSound([128, 255, 0, 200])], [0, 127, 0x80, 72])
  assert.equal(packSound(new Array(5000).fill(128)).length, 4096)
})

test('mailbox: deliver publishes kind last, writes the palette; played counts what the game took; no battle = no mailbox', () => {
  const memory = new GbaMemory(fakeCore()), PTR = 0x02010000, AT = 0x02021000
  const box = new PayloadMailbox(memory, PTR)
  assert.equal(box.deliver('sound', [4]), false) // no battle: the pointer is 0, nothing to deliver to
  memory.w32(PTR, AT) // the battle allocated its mailbox
  assert.ok(box.deliver('sound', new Array(3200).fill(4)))
  assert.equal(memory.u32(AT), PAYLOAD_MAGIC); assert.equal(memory.u16(AT + 4), 2); assert.equal(memory.u8(AT + 6), 1); assert.equal(memory.u16(AT + 8), 3200)
  assert.equal((memory.u8(AT + 60) << 24) >> 24, 4 - 128)
  assert.equal(box.played(), 0)
  memory.w8(AT + 6, 0); memory.w16(AT + 10, 1) // the game played it
  assert.equal(box.played(), 1)
  const pal = Array.from({ length: 16 }, (_, i) => [i * 16, 255, 0] as [number, number, number])
  assert.ok(box.deliver('image', new Array(4096).fill(15), pal))
  assert.equal(memory.u8(AT + 6), 2); assert.equal(memory.u8(AT + 7), 4); assert.equal(memory.u16(AT + 8), 2048); assert.equal(memory.u8(AT + 60), 0xFF)
  assert.equal(memory.u16(AT + 12 + 2 * 15), bgr555([240, 255, 0]))
})
