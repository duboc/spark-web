import { describe, expect, it } from 'vitest'
import {
  parsePreset,
  parsePresetDetailed,
  presetChecksum,
  serializePreset,
  validatePreset,
  withChannel,
} from '../src/protocol/preset.js'
import { ProtocolError, hex } from '../src/protocol/codec.js'
import { LIVE_CHANNEL } from '../src/protocol/catalog.js'
import { quantizePreset, samplePreset } from './helpers.js'

describe('preset round trip', () => {
  it('parses back into exactly what was serialised', () => {
    const preset = quantizePreset(samplePreset())
    expect(parsePreset(serializePreset(preset))).toEqual(preset)
  })

  it('survives a second pass through the wire form', () => {
    // Lossless means lossless: a preset read off the amp, written to a file,
    // read back and re-sent must be byte-identical, or "diffable presets" is a
    // slogan rather than a feature.
    const once = serializePreset(quantizePreset(samplePreset()))
    const twice = serializePreset(parsePreset(once))
    expect(hex(twice)).toBe(hex(once))
  })

  it('survives a trip through JSON, which is how presets get stored', () => {
    const preset = quantizePreset(samplePreset())
    const revived = JSON.parse(JSON.stringify(preset))
    expect(parsePreset(serializePreset(revived))).toEqual(preset)
  })

  it('keeps optional loudness and extra gain when present', () => {
    const preset = quantizePreset(samplePreset({ loudness: 0.75, extraGain: 0.25 }))
    const parsed = parsePreset(serializePreset(preset))
    expect(parsed.loudness).toBeCloseTo(0.75, 6)
    expect(parsed.extraGain).toBeCloseTo(0.25, 6)
  })

  it('omits them entirely when absent, rather than writing zeros', () => {
    const parsed = parsePreset(serializePreset(quantizePreset(samplePreset())))
    expect('loudness' in parsed).toBe(false)
    expect('extraGain' in parsed).toBe(false)
  })

  it('reads a preset carrying loudness but not extra gain', () => {
    const preset = quantizePreset(samplePreset({ loudness: 0.5 }))
    const parsed = parsePreset(serializePreset(preset))
    expect(parsed.loudness).toBeCloseTo(0.5, 6)
    expect('extraGain' in parsed).toBe(false)
  })

  it('handles a long uuid as a d9 string', () => {
    const bytes = serializePreset(quantizePreset(samplePreset()))
    // 00, channel, then the uuid — 36 characters, too long for a fixstr.
    expect(bytes[2]).toBe(0xd9)
    expect(bytes[3]).toBe(36)
  })

  it('writes the channel where the parser expects it', () => {
    const stored = serializePreset(quantizePreset(samplePreset({ channel: 2 })))
    expect(stored[1]).toBe(2)
    expect(parsePreset(stored).channel).toBe(2)
  })
})

describe('checksum', () => {
  it('is what serialize wrote', () => {
    const bytes = serializePreset(quantizePreset(samplePreset()))
    const parsed = parsePresetDetailed(bytes)
    expect(parsed.checksum).toBe(parsed.expectedChecksum)
  })

  it('counts every byte after the channel, substituting cc above 127', () => {
    const bytes = Uint8Array.from([0x00, 0x7f, 0x01, 0x02, 0xff])
    expect(presetChecksum(bytes)).toBe((0x01 + 0x02 + 0xcc) & 0xff)
  })

  it('ignores the leading byte and the channel', () => {
    const a = Uint8Array.from([0x00, 0x00, 0x10])
    const b = Uint8Array.from([0x00, 0x7f, 0x10])
    expect(presetChecksum(a)).toBe(presetChecksum(b))
  })

  it('wraps at 256', () => {
    expect(presetChecksum(Uint8Array.from([0, 0, 0x7f, 0x7f, 0x7f, 0x7f]))).toBe((0x7f * 4) & 0xff)
  })

  it('notices a preset whose stored checksum is wrong', () => {
    const bytes = serializePreset(quantizePreset(samplePreset()))
    bytes[bytes.length - 1] = (bytes[bytes.length - 1]! + 1) & 0xff
    const parsed = parsePresetDetailed(bytes)
    expect(parsed.checksum).not.toBe(parsed.expectedChecksum)
  })
})

describe('malformed presets', () => {
  it('rejects one that does not start with 00', () => {
    const bytes = serializePreset(quantizePreset(samplePreset()))
    bytes[0] = 0x01
    expect(() => parsePreset(bytes)).toThrow(ProtocolError)
  })

  it('rejects a truncated preset instead of inventing the rest', () => {
    const bytes = serializePreset(quantizePreset(samplePreset()))
    expect(() => parsePreset(bytes.subarray(0, 30))).toThrow(ProtocolError)
  })

  it('rejects a missing parameter separator', () => {
    const preset = quantizePreset(samplePreset())
    const bytes = serializePreset(preset)
    // Corrupt the first 91 separator we can find.
    const at = bytes.indexOf(0x91)
    expect(at).toBeGreaterThan(0)
    bytes[at] = 0x90
    expect(() => parsePreset(bytes)).toThrow(ProtocolError)
  })

  it('rejects an empty buffer', () => {
    expect(() => parsePreset(new Uint8Array(0))).toThrow(ProtocolError)
  })
})

describe('validatePreset', () => {
  it('passes a well-formed preset', () => {
    expect(validatePreset(samplePreset())).toEqual([])
  })

  it('accepts the live channel', () => {
    expect(validatePreset(samplePreset({ channel: LIVE_CHANNEL }))).toEqual([])
  })

  it('rejects a channel that is neither a slot nor live', () => {
    expect(validatePreset(samplePreset({ channel: 9 }))).toContainEqual(
      expect.stringContaining('channel'),
    )
  })

  it('rejects a chain that is not seven slots', () => {
    const preset = samplePreset()
    preset.pedals = preset.pedals.slice(0, 5)
    expect(validatePreset(preset)).toContainEqual(expect.stringContaining('7 slots'))
  })

  it('rejects a parameter outside 0..1', () => {
    const preset = samplePreset()
    preset.pedals[3]!.params[0] = 1.5
    expect(validatePreset(preset)).toContainEqual(expect.stringContaining('0.0-1.0'))
  })

  it('rejects a parameter that is not a number at all', () => {
    const preset = samplePreset()
    preset.pedals[3]!.params[0] = Number.NaN
    expect(validatePreset(preset)).toContainEqual(expect.stringContaining('0.0-1.0'))
  })

  it('rejects an empty effect name', () => {
    const preset = samplePreset()
    preset.pedals[0]!.name = ''
    expect(validatePreset(preset)).toContainEqual(expect.stringContaining('no effect name'))
  })

  it('rejects nonsense bpm', () => {
    expect(validatePreset(samplePreset({ bpm: 0 }))).toContainEqual(expect.stringContaining('bpm'))
  })
})

describe('withChannel', () => {
  it('retargets without touching the original', () => {
    const preset = samplePreset()
    const moved = withChannel(preset, 1)
    expect(moved.channel).toBe(1)
    expect(preset.channel).toBe(LIVE_CHANNEL)
    expect(moved.pedals).toEqual(preset.pedals)
  })
})
