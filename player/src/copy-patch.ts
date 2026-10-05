// Copy-only source delta. The patch contains offsets/lengths, no ROM bytes.
import { ROM_SIZE } from './patch.ts'
export function applyCopyPatch(base: Uint8Array, patch: Uint8Array): Uint8Array<ArrayBuffer> {
  if (base.byteLength !== ROM_SIZE || patch.byteLength < 13 || new TextDecoder().decode(patch.subarray(0, 5)) !== 'CRCP1') throw new Error('Invalid Code Red copy patch.')
  const view = new DataView(patch.buffer, patch.byteOffset, patch.byteLength)
  const size = view.getUint32(5, true), count = view.getUint32(9, true)
  if (size !== ROM_SIZE || count > ROM_SIZE || patch.byteLength !== 13 + count * 8) throw new Error('Invalid Code Red copy patch size.')
  const output = new Uint8Array(size)
  let written = 0
  for (let index = 0; index < count; index++) {
    const source = view.getUint32(13 + index * 8, true), length = view.getUint32(17 + index * 8, true)
    if (!length || source > base.length - length || written > size - length) throw new Error('Invalid Code Red copy patch bounds.')
    output.set(base.subarray(source, source + length), written)
    written += length
  }
  if (written !== size) throw new Error('Incomplete Code Red copy patch.')
  return output
}
