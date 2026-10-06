// Byte battles, host side: answer the ROM's damage requests by running the
// move's script in the sandbox; the bytes of its output are the damage.
import type { ByteMailbox, ByteRequest } from '../bridge/battle-bytes.ts'
import { BYTES_MAX } from '../bridge/battle-bytes.ts'
import { scriptFor, utf8Bytes } from './moves.ts'

export interface ScriptRunner { run(source: string, inputJSON: string): Promise<{ ok: boolean; value?: unknown; error?: string }> }
export interface Names { moveName(id: number): string; speciesName(id: number): string; typeName(id: number): string }

export interface Hit {
  side: 0 | 1                 // attacker: 0 player, 1 opponent
  attacker: string; target: string; move: string; file: string
  output: string; bytes: number; error?: string
  targetHpBefore: number      // HP when the script ran; HP lost afterwards = bytes absorbed
}

export class ByteBattle {
  /** Last output that landed on each side's mon (index = target side). */
  readonly lastHit: [Hit | null, Hit | null] = [null, null]
  private pending: ByteRequest | null = null
  private readonly mailbox: ByteMailbox
  private readonly runner: ScriptRunner
  private readonly names: Names
  private readonly onHit: (hit: Hit) => void

  constructor(mailbox: ByteMailbox, runner: ScriptRunner, names: Names, onHit: (hit: Hit) => void = () => {}) {
    this.mailbox = mailbox; this.runner = runner; this.names = names; this.onHit = onHit
  }

  /** Call often (every frame or so). */
  async poll(): Promise<void> {
    this.mailbox.enable(true)
    if (this.pending) return
    const request = this.mailbox.snapshot()
    if (!request) return
    this.pending = request
    try {
      const move = this.names.moveName(request.move)
      const script = scriptFor(move, true)
      const attacker = this.names.speciesName(request.attackerSpecies), target = this.names.speciesName(request.targetSpecies)
      const input = {
        me: { name: attacker, level: request.level, attack: request.attack },
        foe: { name: target, defense: Math.max(1, request.defense), hp: request.targetHp, maxHp: request.targetMaxHp },
        move: { name: move, power: request.power, type: this.names.typeName(request.moveType) },
        crit: request.crit,
      }
      const result = await this.runner.run(script.source, JSON.stringify(input))
      const output = result.ok && typeof result.value === 'string' ? result.value : ''
      const bytes = Math.min(BYTES_MAX, utf8Bytes(output))
      const ok = result.ok && bytes >= 1
      this.mailbox.reply(request, ok ? bytes : null)
      const hit: Hit = { side: request.attackerSide, attacker, target, move, file: script.file, output, bytes: ok ? bytes : 0, targetHpBefore: request.targetHp, ...(ok ? {} : { error: result.error ?? 'empty output' }) }
      this.lastHit[request.attackerSide === 0 ? 1 : 0] = hit
      this.onHit(hit)
    } catch {
      this.mailbox.reply(request, null)
    } finally {
      this.pending = null
    }
  }
}
