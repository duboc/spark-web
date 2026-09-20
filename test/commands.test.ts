import { describe, expect, it } from 'vitest'
import {
  connectHandshake,
  requestLiveState,
  requestPreset,
  selectPreset,
  sendPreset,
  setParam,
  storeToSlot,
  swapModel,
  toggleEffect,
} from '../src/protocol/commands.js'
import { AMP_SLOT, HARDWARE_PRESETS } from '../src/protocol/catalog.js'
import {
  BLOCK_HEADER_SIZE,
  CHUNK_HEADER_SIZE,
  ChunkStream,
  MAX_BLOCK_TO_AMP,
  splitChunkData,
} from '../src/protocol/frame.js'
import { concat, dec7, hex } from '../src/protocol/codec.js'
import { parsePreset, serializePreset } from '../src/protocol/preset.js'
import { quantizePreset, samplePreset } from './helpers.js'

/** The payload a single-block command carries, decoded back to 8-bit. */
function payloadOf(blocks: Uint8Array[]): Uint8Array {
  expect(blocks).toHaveLength(1)
  const block = blocks[0] as Uint8Array
  return dec7(block.slice(BLOCK_HEADER_SIZE + CHUNK_HEADER_SIZE, -1))
}

describe('the amp slot uses different command bytes', () => {
  it('addresses the amp with 03 37 for parameters', () => {
    const command = setParam(AMP_SLOT, 'Twin', 0, 0.5)
    expect(command.cmd).toBe(0x03)
    expect(command.sub).toBe(0x37)
  })

  it('addresses every other slot with 01 04', () => {
    for (const slot of [0, 1, 2, 4, 5, 6]) {
      const command = setParam(slot, 'DelayMono', 0, 0.5)
      expect(command.cmd, `slot ${slot}`).toBe(0x01)
      expect(command.sub, `slot ${slot}`).toBe(0x04)
    }
  })

  it('swaps the amp model with 03 06 and everything else with 01 06', () => {
    expect(swapModel(AMP_SLOT, 'Twin', 'Plexi')).toMatchObject({ cmd: 0x03, sub: 0x06 })
    expect(swapModel(2, 'Fuzz', 'Booster')).toMatchObject({ cmd: 0x01, sub: 0x06 })
  })
})

describe('command payloads', () => {
  it('writes effect names as prefixed strings', () => {
    // The length appears twice. Commands that use the plain form are ignored
    // without complaint, which is the worst possible failure mode.
    const payload = payloadOf(toggleEffect('Fuzz', true).blocks)
    expect(hex(payload)).toBe('04 a4 46 75 7a 7a c3')
  })

  it('writes a parameter as name, index, then a big-endian float', () => {
    const payload = payloadOf(setParam(AMP_SLOT, 'Twin', 2, 0.5).blocks)
    expect(hex(payload)).toBe('04 a4 54 77 69 6e 02 ca 3f 00 00 00')
  })

  it('writes a swap as two prefixed strings', () => {
    const payload = payloadOf(swapModel(2, 'Fuzz', 'Booster').blocks)
    expect(hex(payload)).toBe('04 a4 46 75 7a 7a 07 a7 42 6f 6f 73 74 65 72')
  })

  it('selects a preset with a leading zero byte', () => {
    expect(hex(payloadOf(selectPreset(2).blocks))).toBe('00 02')
  })

  it('asks for a stored preset by number and the live sound with 01 00', () => {
    expect(hex(payloadOf(requestPreset(0).blocks))).toBe('00 00')
    expect(hex(payloadOf(requestLiveState().blocks))).toBe('01 00')
  })

  it('handles a model name containing a space', () => {
    const payload = payloadOf(swapModel(AMP_SLOT, 'Twin', 'AC Boost').blocks)
    expect(payload).toContain(0x20)
    expect(new TextDecoder().decode(payload.slice(-8))).toBe('AC Boost')
  })
})

describe('guarding what goes on the wire', () => {
  it('clamps a parameter into 0..1 rather than sending it', () => {
    expect(payloadOf(setParam(0, 'bias.noisegate', 0, 5).blocks).slice(-4)).toEqual(
      payloadOf(setParam(0, 'bias.noisegate', 0, 1).blocks).slice(-4),
    )
    expect(payloadOf(setParam(0, 'bias.noisegate', 0, -3).blocks).slice(-4)).toEqual(
      payloadOf(setParam(0, 'bias.noisegate', 0, 0).blocks).slice(-4),
    )
  })

  it('refuses a parameter value that is not a number', () => {
    expect(() => setParam(0, 'bias.noisegate', 0, Number.NaN)).toThrow(RangeError)
  })

  it('refuses a slot outside the chain', () => {
    expect(() => setParam(7, 'Twin', 0, 0.5)).toThrow(RangeError)
    expect(() => setParam(-1, 'Twin', 0, 0.5)).toThrow(RangeError)
  })

  it('refuses a hardware preset outside 1..4', () => {
    expect(() => selectPreset(HARDWARE_PRESETS)).toThrow(RangeError)
    expect(() => storeToSlot(-1)).toThrow(RangeError)
  })

  it('refuses to upload a preset that fails validation', () => {
    const broken = samplePreset()
    broken.pedals[0]!.params[0] = 42
    expect(() => sendPreset(broken)).toThrow(/invalid preset/)
  })
})

describe('preset upload', () => {
  it('splits across blocks, none over the ceiling', () => {
    const command = sendPreset(quantizePreset(samplePreset()))
    expect(command.blocks.length).toBeGreaterThan(1)
    for (const block of command.blocks) expect(block.length).toBeLessThanOrEqual(MAX_BLOCK_TO_AMP)
  })

  it('puts the preset on the wire so that reading the wire gives it back', () => {
    // Take the framed blocks apart the way a receiver would — strip block
    // headers, drop the chunk headers, undo the 7-bit encoding, join — and the
    // preset must come back whole. If this passes and the amp still rejects the
    // upload, the disagreement is with the amp rather than with ourselves, and
    // that is the distinction worth being able to make at three in the morning.
    const preset = quantizePreset(samplePreset({ channel: 1 }))
    const command = sendPreset(preset, 0x51)

    const stream = new ChunkStream()
    const chunks = command.blocks.flatMap((block) => stream.push(block))
    expect(chunks.length).toBe(command.blocks.length)
    expect(new Set(chunks.map((c) => c.seq))).toEqual(new Set([0x51]))

    const parts = chunks.map((chunk) => {
      const split = splitChunkData(dec7(chunk.body))
      expect(split.hasHeader).toBe(true)
      return split.data
    })

    const payload = concat(parts)
    expect(hex(payload)).toBe(hex(serializePreset(preset)))
    expect(parsePreset(payload)).toEqual(preset)
  })
})

describe('connect handshake', () => {
  it('asks for identity, then the selected preset, then all of them, then the live sound', () => {
    const labels = connectHandshake().map((c) => c.label)
    expect(labels).toEqual([
      'get amp name',
      'get serial number',
      'get current preset number',
      'get preset 1',
      'get preset 2',
      'get preset 3',
      'get preset 4',
      'get live state',
    ])
  })

  it('gives every command a gap and a label', () => {
    for (const command of connectHandshake()) {
      expect(command.gapMs).toBeGreaterThan(0)
      expect(command.label).toBeTruthy()
    }
  })
})
