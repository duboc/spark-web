/**
 * The preset: the amp's whole sound as one structure.
 *
 * This is the pivot of the project. {@link Preset} is the canonical shape — it
 * is what the UI renders, what gets written to disk as JSON, and what gets
 * serialised back onto the wire. Parsing and serialising are inverses, and the
 * test suite holds them to it, because "presets you can keep in a file and diff"
 * only means anything if the round trip is lossless.
 *
 * Wire layout, after 7-bit decoding:
 * ```
 *   00                 fixed
 *   channel            00-03 for a hardware slot, 7f for the live sound
 *   uuid               string
 *   name               string
 *   version            string
 *   description        string
 *   icon               string
 *   bpm                float
 *   97                 array marker — seven pedals follow
 *     × 7:
 *       name           string
 *       c3 | c2        on / off
 *       90 + n         parameter count
 *         × n:
 *           index      raw byte
 *           91         separator
 *           value      float
 *   loudness           float, present on some presets
 *   extra gain         float, present on some presets
 *   checksum           one byte
 * ```
 */

import { LIVE_CHANNEL, SLOT_COUNT } from './catalog.js'
import { ProtocolError, Reader, TAG, Writer } from './codec.js'

export interface PedalState {
  /** DSP name, as it goes on the wire. */
  name: string
  on: boolean
  /** Parameter values, 0.0 to 1.0, indexed by parameter number. */
  params: number[]
}

export interface Preset {
  /** 0-3 for a hardware slot, 0x7f for the live sound. */
  channel: number
  uuid: string
  name: string
  version: string
  description: string
  icon: string
  bpm: number
  pedals: PedalState[]
  loudness?: number
  extraGain?: number
}

/**
 * The trailing checksum byte: every byte after the channel summed modulo 256,
 * with any byte above 127 contributing 0xCC instead of itself.
 *
 * The amp tolerates a wrong value here; the official app does not, so presets we
 * write should still carry a correct one. The rule itself comes from community
 * notes and has not been checked against a preset captured from hardware — when
 * the first real capture lands, verify the stored byte against this function
 * before trusting either.
 */
export function presetChecksum(bytes: Uint8Array, from = 2, to = bytes.length): number {
  let sum = 0
  for (let i = from; i < to; i++) {
    const b = bytes[i] as number
    sum += b > 127 ? 0xcc : b
  }
  return sum & 0xff
}

export interface ParsedPreset {
  preset: Preset
  /** The checksum byte as it arrived. */
  checksum: number
  /** What the checksum should have been, by our reading of the rule. */
  expectedChecksum: number
}

/** Parse a decoded preset payload. Throws {@link ProtocolError} on anything malformed. */
export function parsePresetDetailed(data: Uint8Array): ParsedPreset {
  const r = new Reader(data)

  const lead = r.u8('preset lead byte')
  if (lead !== 0x00) {
    throw new ProtocolError(`preset should start with 00, got ${lead.toString(16)}`, 0)
  }

  const channel = r.u8('channel')
  const uuid = r.str('uuid')
  const name = r.str('preset name')
  const version = r.str('version')
  const description = r.str('description')
  const icon = r.str('icon')
  const bpm = r.f32('bpm')

  const pedalCount = r.arrayLen('pedal array')
  const pedals: PedalState[] = []

  for (let i = 0; i < pedalCount; i++) {
    const pedalName = r.str(`pedal ${i} name`)
    const on = r.bool(`pedal ${i} state`)
    const paramCount = r.arrayLen(`pedal ${i} parameter array`)

    const params: number[] = []
    for (let p = 0; p < paramCount; p++) {
      const index = r.u8(`pedal ${i} parameter ${p} index`)
      const separator = r.u8(`pedal ${i} parameter ${p} separator`)
      if (separator !== TAG.PARAM_SEPARATOR) {
        throw new ProtocolError(
          `expected 91 between parameter index and value, got ${separator.toString(16)}`,
          r.pos - 1,
        )
      }
      const value = r.f32(`pedal ${i} parameter ${p} value`)
      while (params.length < index) params.push(0)
      params[index] = value
    }

    pedals.push({ name: pedalName, on, params })
  }

  // Loudness and extra gain are present on some presets and absent on others.
  // A float is unambiguous — it is tagged — so look rather than guess.
  let loudness: number | undefined
  let extraGain: number | undefined
  if (r.remaining > 1 && r.peek() === TAG.FLOAT32) loudness = r.f32('loudness')
  if (r.remaining > 1 && r.peek() === TAG.FLOAT32) extraGain = r.f32('extra gain')

  const checksum = r.remaining > 0 ? r.u8('checksum') : 0

  const preset: Preset = {
    channel,
    uuid,
    name,
    version,
    description,
    icon,
    bpm,
    pedals,
    ...(loudness === undefined ? {} : { loudness }),
    ...(extraGain === undefined ? {} : { extraGain }),
  }

  return {
    preset,
    checksum,
    expectedChecksum: presetChecksum(data, 2, r.pos - 1),
  }
}

export function parsePreset(data: Uint8Array): Preset {
  return parsePresetDetailed(data).preset
}

/** Serialise a preset back to the decoded byte form, checksum included. */
export function serializePreset(preset: Preset): Uint8Array {
  const w = new Writer()

  w.u8(0x00, preset.channel & 0xff)
  w.str(preset.uuid)
  w.str(preset.name)
  w.str(preset.version)
  w.str(preset.description)
  w.str(preset.icon)
  w.f32(preset.bpm)

  w.arrayLen(preset.pedals.length)
  for (const pedal of preset.pedals) {
    w.str(pedal.name)
    w.bool(pedal.on)
    w.arrayLen(pedal.params.length)
    pedal.params.forEach((value, index) => {
      w.u8(index, TAG.PARAM_SEPARATOR)
      w.f32(value)
    })
  }

  if (preset.loudness !== undefined) w.f32(preset.loudness)
  if (preset.extraGain !== undefined) w.f32(preset.extraGain)

  const body = w.toBytes()
  const out = new Uint8Array(body.length + 1)
  out.set(body, 0)
  out[body.length] = presetChecksum(body, 2)
  return out
}

/**
 * Reject anything that would be unkind to send.
 *
 * Invalid settings are documented to be able to wedge the amp until it is
 * power-cycled, so a preset is checked before it goes near the radio rather than
 * after. Returns the problems found; an empty array means it is safe to send.
 */
export function validatePreset(preset: Preset): string[] {
  const problems: string[] = []

  if (preset.channel !== LIVE_CHANNEL && (preset.channel < 0 || preset.channel > 3)) {
    problems.push(`channel must be 0-3 or 0x7f, got ${preset.channel}`)
  }
  if (preset.pedals.length !== SLOT_COUNT) {
    problems.push(`the chain has ${SLOT_COUNT} slots, this preset has ${preset.pedals.length}`)
  }
  if (!Number.isFinite(preset.bpm) || preset.bpm <= 0) {
    problems.push(`bpm must be positive and finite, got ${preset.bpm}`)
  }

  preset.pedals.forEach((pedal, i) => {
    if (!pedal.name) problems.push(`slot ${i} has no effect name`)
    if (pedal.name.length > 31) problems.push(`slot ${i} name is too long to encode: ${pedal.name}`)
    if (pedal.params.length > 15) {
      problems.push(`slot ${i} has ${pedal.params.length} parameters, more than the 15 an array marker encodes`)
    }
    pedal.params.forEach((value, p) => {
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        problems.push(`slot ${i} parameter ${p} must be 0.0-1.0, got ${value}`)
      }
    })
  })

  return problems
}

/** A copy of `preset` bound for a different channel. */
export function withChannel(preset: Preset, channel: number): Preset {
  return { ...preset, channel }
}

export function newUuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  // Good enough for an identifier the amp only ever echoes back.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}
