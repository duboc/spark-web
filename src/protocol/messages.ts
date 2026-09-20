/**
 * Amp → app messages: reassembly and decoding.
 *
 * Decoding never throws. A message the amp sends that we cannot read is a
 * curiosity to be logged, not a reason to tear down a working connection, so
 * anything unrecognised or malformed comes back as {@link UnknownMessage} with
 * its bytes attached — which is also exactly what you want in the protocol log
 * when you are working out what the amp just said.
 */

import { Reader, dec7, concat, hex } from './codec.js'
import { splitChunkData, type RawChunk } from './frame.js'
import { parsePresetDetailed, type Preset } from './preset.js'

export interface AckMessage {
  type: 'ack'
  /** Mirrors the sub-command being acknowledged. */
  sub: number
}
export interface PresetMessage {
  type: 'preset'
  preset: Preset
  checksumOk: boolean
}
export interface PresetNumberMessage {
  type: 'presetNumber'
  preset: number
}
export interface PresetButtonMessage {
  type: 'presetButton'
  preset: number
}
export interface PresetStoredMessage {
  type: 'presetStored'
  slot: number
}
export interface EffectToggledMessage {
  type: 'effectToggled'
  name: string
  on: boolean
}
export interface EffectParamMessage {
  type: 'effectParam'
  name: string
  index: number
  value: number
}
export interface EffectSwappedMessage {
  type: 'effectSwapped'
  from: string
  to: string
}
export interface BpmMessage {
  type: 'bpm'
  value: number
}
export interface AmpNameMessage {
  type: 'ampName'
  name: string
}
export interface SerialNumberMessage {
  type: 'serialNumber'
  serial: string
}
export interface UnknownMessage {
  type: 'unknown'
  cmd: number
  sub: number
  data: Uint8Array
  reason: string
}

export type AmpMessage =
  | AckMessage
  | PresetMessage
  | PresetNumberMessage
  | PresetButtonMessage
  | PresetStoredMessage
  | EffectToggledMessage
  | EffectParamMessage
  | EffectSwappedMessage
  | BpmMessage
  | AmpNameMessage
  | SerialNumberMessage
  | UnknownMessage

/** A one-line description, for the protocol log. */
export function describe(message: AmpMessage): string {
  switch (message.type) {
    case 'ack':
      return `ack ${message.sub.toString(16).padStart(2, '0')}`
    case 'preset':
      return `preset "${message.preset.name}" on channel ${message.preset.channel.toString(16)}${
        message.checksumOk ? '' : ' (checksum mismatch)'
      }`
    case 'presetNumber':
      return `current preset ${message.preset + 1}`
    case 'presetButton':
      return `preset button ${message.preset + 1} pressed`
    case 'presetStored':
      return `stored to slot ${message.slot + 1}`
    case 'effectToggled':
      return `${message.name} ${message.on ? 'on' : 'off'}`
    case 'effectParam':
      return `${message.name} p${message.index} = ${message.value.toFixed(3)}`
    case 'effectSwapped':
      return `${message.from} → ${message.to}`
    case 'bpm':
      return `bpm ${message.value.toFixed(1)}`
    case 'ampName':
      return `amp name "${message.name}"`
    case 'serialNumber':
      return `serial ${message.serial}`
    case 'unknown':
      return `unread cmd=${message.cmd.toString(16)} sub=${message.sub.toString(16)}: ${message.reason} [${hex(message.data)}]`
  }
}

/**
 * Collects chunks into whole messages.
 *
 * Partial messages are keyed by command and sub-command, not by the sequence
 * byte. The sequence byte looks like it should group a message's chunks and does
 * not: across a capture of fifteen consecutive preset replies, every chunk in
 * every direction carried `3a`. Keying by it would have worked only because the
 * amp never has two messages of one kind in flight at once, which is luck rather
 * than design.
 */
export class MessageAssembler {
  readonly #pending = new Map<
    number,
    { cmd: number; sub: number; total: number; parts: (Uint8Array | undefined)[]; received: number }
  >()

  /** Drop any half-received messages. Call on connect. */
  reset(): void {
    this.#pending.clear()
  }

  /** Feed one chunk; get a message back once one is complete. */
  accept(chunk: RawChunk): AmpMessage | null {
    // Decode before looking for the header: it travels inside the encoded region.
    const { total, index, data } = splitChunkData(dec7(chunk.body))

    if (total <= 1) {
      return decodeMessage(chunk.cmd, chunk.sub, data)
    }

    const key = (chunk.cmd << 8) | chunk.sub
    let entry = this.#pending.get(key)
    if (!entry || index === 0 || entry.total !== total) {
      entry = { cmd: chunk.cmd, sub: chunk.sub, total, parts: new Array(total).fill(undefined), received: 0 }
      this.#pending.set(key, entry)
    }
    if (index >= entry.total) return null
    // Count only the first arrival of each index. A missing chunk must leave the
    // message incomplete rather than silently assembling around the hole — note
    // that a sparse array's `every` skips holes and would call this complete.
    if (entry.parts[index] === undefined) entry.received++
    entry.parts[index] = data

    if (entry.received < entry.total) return null

    this.#pending.delete(key)
    return decodeMessage(entry.cmd, entry.sub, concat(entry.parts as Uint8Array[]))
  }

  /** Feed several chunks; get back every message that completed. */
  acceptAll(chunks: readonly RawChunk[]): AmpMessage[] {
    const out: AmpMessage[] = []
    for (const chunk of chunks) {
      const message = this.accept(chunk)
      if (message) out.push(message)
    }
    return out
  }
}

/** Decode one complete, 7-bit-decoded message body. */
export function decodeMessage(cmd: number, sub: number, data: Uint8Array): AmpMessage {
  try {
    return decodeOrThrow(cmd, sub, data)
  } catch (error) {
    return {
      type: 'unknown',
      cmd,
      sub,
      data,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

function decodeOrThrow(cmd: number, sub: number, data: Uint8Array): AmpMessage {
  // Acknowledgements mirror the sub-command they acknowledge and carry nothing else.
  if (cmd === 0x04 || cmd === 0x05) return { type: 'ack', sub }

  if (cmd !== 0x03) {
    return { type: 'unknown', cmd, sub, data, reason: `no decoder for command ${cmd.toString(16)}` }
  }

  const r = new Reader(data)

  switch (sub) {
    case 0x01: {
      const parsed = parsePresetDetailed(data)
      return {
        type: 'preset',
        preset: parsed.preset,
        checksumOk: parsed.checksum === parsed.expectedChecksum,
      }
    }
    case 0x06:
      return { type: 'effectSwapped', from: r.anyStr('old effect'), to: r.anyStr('new effect') }
    case 0x10:
      return { type: 'presetNumber', preset: readSlot(r) }
    case 0x11:
      return { type: 'ampName', name: r.anyStr('amp name') }
    case 0x15:
      return { type: 'effectToggled', name: r.anyStr('effect'), on: r.bool('effect state') }
    case 0x23:
      return { type: 'serialNumber', serial: r.anyStr('serial number') }
    case 0x27:
      return { type: 'presetStored', slot: readSlot(r) }
    case 0x37: {
      const name = r.anyStr('effect')
      const index = r.u8('parameter index')
      return { type: 'effectParam', name, index, value: r.f32('parameter value') }
    }
    case 0x38:
      return { type: 'presetButton', preset: readSlot(r) }
    case 0x63:
      return { type: 'bpm', value: r.f32('bpm') }
    default:
      return { type: 'unknown', cmd, sub, data, reason: `no decoder for 03 ${sub.toString(16)}` }
  }
}

/** Slot replies are a leading byte then the slot number. */
function readSlot(r: Reader): number {
  r.u8('slot prefix')
  const n = r.u8('slot number')
  if (n > 0x7f) throw new Error(`slot number ${n} out of range`)
  return n
}
