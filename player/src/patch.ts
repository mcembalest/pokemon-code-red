export const BASE_SHA1 = '41cb23d8dccc8ebd7c649cd8fbb58eeace6e2fdc'
/** The FireRed files a player may bring (2026-10-10: Rev 1 too; many dumps are v1.1). Each has its own copy patch. */
export const BASES: Record<string, string> = {
  '41cb23d8dccc8ebd7c649cd8fbb58eeace6e2fdc': 'Pokémon FireRed (USA) v1.0',
  'dd5945db9b930750cb39d00c84da8571feebf417': 'Pokémon FireRed (USA) v1.1',
}
export const ROM_SIZE = 16 * 1024 * 1024

export function applyIps(base: Uint8Array, patch: Uint8Array): Uint8Array {
  const text = (from: number, length: number) => new TextDecoder().decode(patch.subarray(from, from + length))
  if (text(0, 5) !== 'PATCH') throw new Error('Invalid Code Red patch header.')
  const result = base.slice()
  let position = 5
  while (text(position, 3) !== 'EOF') {
    if (position + 5 > patch.length) throw new Error('Truncated Code Red patch.')
    const offset = patch[position]! * 65536 + patch[position + 1]! * 256 + patch[position + 2]!
    const size = patch[position + 3]! * 256 + patch[position + 4]!
    position += 5
    if (!size || position + size > patch.length || offset + size > result.length) {
      throw new Error('Invalid Code Red patch record.')
    }
    result.set(patch.subarray(position, position + size), offset)
    position += size
  }
  if (position + 3 !== patch.length) throw new Error('Unexpected Code Red patch trailer.')
  return result
}

export async function sha1(bytes: Uint8Array): Promise<string> {
  // Copy to a plain ArrayBuffer for both Web Crypto and TypeScript's BufferSource type.
  const digest = await crypto.subtle.digest('SHA-1', new Uint8Array(bytes).buffer)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
