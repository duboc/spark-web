import { describe, expect, it } from 'vitest'
import { MessageAssembler, decodeMessage, describe as describeMessage } from '../src/protocol/messages.js'
import { ChunkStream, encodeBlocks, type RawChunk } from '../src/protocol/frame.js'
import { Writer, concat, fromHex } from '../src/protocol/codec.js'
import { serializePreset } from '../src/protocol/preset.js'
import { quantizePreset, samplePreset } from './helpers.js'

/**
 * Round-tripping through our own encoder is the only way to exercise the decoder
 * until captures from hardware exist. It proves the two halves agree; it cannot
 * prove either half matches the amp. Real fixtures go in test/fixtures/.
 */
function chunksFor(cmd: number, sub: number, payload: Uint8Array, seq = 0x10): RawChunk[] {
  const stream = new ChunkStream()
  return encodeBlocks(cmd, sub, payload, { seq }).flatMap((block) => stream.push(block))
}

describe('decodeMessage', () => {
  it('reads an acknowledgement', () => {
    expect(decodeMessage(0x04, 0x38, new Uint8Array(0))).toEqual({ type: 'ack', sub: 0x38 })
  })

  it('reads the current preset number', () => {
    expect(decodeMessage(0x03, 0x10, fromHex('00 02'))).toEqual({ type: 'presetNumber', preset: 2 })
  })

  it('reads a preset button press', () => {
    expect(decodeMessage(0x03, 0x38, fromHex('00 03'))).toEqual({ type: 'presetButton', preset: 3 })
  })

  it('reads a store confirmation', () => {
    expect(decodeMessage(0x03, 0x27, fromHex('00 01'))).toEqual({ type: 'presetStored', slot: 1 })
  })

  it('reads an effect toggle', () => {
    const payload = new Writer().pstr('DelayMono').bool(false).toBytes()
    expect(decodeMessage(0x03, 0x15, payload)).toEqual({
      type: 'effectToggled',
      name: 'DelayMono',
      on: false,
    })
  })

  it('reads a knob turned on the amp', () => {
    const payload = new Writer().pstr('Twin').u8(1).f32(0.625).toBytes()
    expect(decodeMessage(0x03, 0x37, payload)).toEqual({
      type: 'effectParam',
      name: 'Twin',
      index: 1,
      value: 0.625,
    })
  })

  it('reads a model swap', () => {
    const payload = new Writer().pstr('Twin').pstr('AC Boost').toBytes()
    expect(decodeMessage(0x03, 0x06, payload)).toEqual({
      type: 'effectSwapped',
      from: 'Twin',
      to: 'AC Boost',
    })
  })

  it('reads a bpm update', () => {
    const payload = new Writer().f32(128).toBytes()
    expect(decodeMessage(0x03, 0x63, payload)).toEqual({ type: 'bpm', value: 128 })
  })

  it('reads the amp name and serial number', () => {
    expect(decodeMessage(0x03, 0x11, new Writer().pstr('Spark 40').toBytes())).toEqual({
      type: 'ampName',
      name: 'Spark 40',
    })
    expect(decodeMessage(0x03, 0x23, new Writer().str('S40-0001').toBytes())).toEqual({
      type: 'serialNumber',
      serial: 'S40-0001',
    })
  })

  it('reads a whole preset', () => {
    const preset = quantizePreset(samplePreset())
    const message = decodeMessage(0x03, 0x01, serializePreset(preset))
    expect(message.type).toBe('preset')
    if (message.type !== 'preset') return
    expect(message.preset).toEqual(preset)
    expect(message.checksumOk).toBe(true)
  })

  it('flags a preset whose checksum does not add up', () => {
    const bytes = serializePreset(quantizePreset(samplePreset()))
    bytes[bytes.length - 1] = (bytes[bytes.length - 1]! ^ 0xff) & 0xff
    const message = decodeMessage(0x03, 0x01, bytes)
    expect(message).toMatchObject({ type: 'preset', checksumOk: false })
  })
})

describe('decoding never throws', () => {
  it('returns unknown for an unrecognised sub-command', () => {
    expect(decodeMessage(0x03, 0x7e, fromHex('01 02'))).toMatchObject({ type: 'unknown', sub: 0x7e })
  })

  it('returns unknown for an unrecognised command', () => {
    expect(decodeMessage(0x09, 0x01, fromHex('01'))).toMatchObject({ type: 'unknown', cmd: 0x09 })
  })

  it('returns unknown, with a reason, for a truncated message', () => {
    // A malformed message is a thing to log, never a reason to drop a working
    // connection.
    const message = decodeMessage(0x03, 0x37, fromHex('04 a4 54 77'))
    expect(message.type).toBe('unknown')
    if (message.type !== 'unknown') return
    expect(message.reason).toBeTruthy()
  })

  it('returns unknown for a preset that is not one', () => {
    expect(decodeMessage(0x03, 0x01, fromHex('ff ff ff'))).toMatchObject({ type: 'unknown' })
  })

  it('describes every message it produces', () => {
    const samples = [
      decodeMessage(0x04, 0x38, new Uint8Array(0)),
      decodeMessage(0x03, 0x10, fromHex('00 01')),
      decodeMessage(0x03, 0x38, fromHex('00 01')),
      decodeMessage(0x03, 0x27, fromHex('00 01')),
      decodeMessage(0x03, 0x15, new Writer().pstr('Fuzz').bool(true).toBytes()),
      decodeMessage(0x03, 0x37, new Writer().pstr('Fuzz').u8(0).f32(0.5).toBytes()),
      decodeMessage(0x03, 0x06, new Writer().pstr('Fuzz').pstr('Twin').toBytes()),
      decodeMessage(0x03, 0x63, new Writer().f32(90).toBytes()),
      decodeMessage(0x03, 0x11, new Writer().pstr('Spark 40').toBytes()),
      decodeMessage(0x03, 0x23, new Writer().str('S40').toBytes()),
      decodeMessage(0x03, 0x01, serializePreset(quantizePreset(samplePreset()))),
      decodeMessage(0x09, 0x09, fromHex('00')),
    ]
    for (const message of samples) {
      expect(describeMessage(message), message.type).toBeTruthy()
    }
  })
})

describe('MessageAssembler', () => {
  it('passes a single-chunk message straight through', () => {
    const assembler = new MessageAssembler()
    const chunks = chunksFor(0x03, 0x10, fromHex('00 02'))
    expect(assembler.acceptAll(chunks)).toEqual([{ type: 'presetNumber', preset: 2 }])
  })

  it('joins the chunks of a preset back into one message', () => {
    const preset = quantizePreset(samplePreset())
    const chunks = chunksFor(0x03, 0x01, serializePreset(preset))
    expect(chunks.length).toBeGreaterThan(1)

    const assembler = new MessageAssembler()
    const messages = assembler.acceptAll(chunks)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ type: 'preset', checksumOk: true })
    if (messages[0]?.type === 'preset') expect(messages[0].preset).toEqual(preset)
  })

  it('emits nothing until the last chunk arrives', () => {
    const chunks = chunksFor(0x03, 0x01, serializePreset(quantizePreset(samplePreset())))
    const assembler = new MessageAssembler()
    for (const chunk of chunks.slice(0, -1)) expect(assembler.accept(chunk)).toBeNull()
    expect(assembler.accept(chunks[chunks.length - 1] as RawChunk)).toMatchObject({ type: 'preset' })
  })

  it('keeps two interleaved messages apart by their sequence byte', () => {
    const a = quantizePreset(samplePreset({ name: 'Alpha', channel: 0 }))
    const b = quantizePreset(samplePreset({ name: 'Beta', channel: 1 }))
    const chunksA = chunksFor(0x03, 0x01, serializePreset(a), 0x21)
    const chunksB = chunksFor(0x03, 0x01, serializePreset(b), 0x22)

    const assembler = new MessageAssembler()
    const interleaved: RawChunk[] = []
    const longest = Math.max(chunksA.length, chunksB.length)
    for (let i = 0; i < longest; i++) {
      if (chunksA[i]) interleaved.push(chunksA[i] as RawChunk)
      if (chunksB[i]) interleaved.push(chunksB[i] as RawChunk)
    }

    const names = assembler
      .acceptAll(interleaved)
      .map((m) => (m.type === 'preset' ? m.preset.name : m.type))
    expect(names.sort()).toEqual(['Alpha', 'Beta'])
  })

  it('starts a fresh message when a new chunk zero arrives mid-flight', () => {
    // The amp being interrupted should not leave us stuck holding half a preset
    // forever.
    const chunks = chunksFor(0x03, 0x01, serializePreset(quantizePreset(samplePreset())), 0x30)
    const assembler = new MessageAssembler()
    assembler.accept(chunks[0] as RawChunk)
    const messages = assembler.acceptAll(chunks)
    expect(messages).toHaveLength(1)
  })

  it('drops partial messages on reset', () => {
    const chunks = chunksFor(0x03, 0x01, serializePreset(quantizePreset(samplePreset())))
    const assembler = new MessageAssembler()
    assembler.accept(chunks[0] as RawChunk)
    assembler.reset()
    for (const chunk of chunks.slice(1)) expect(assembler.accept(chunk)).toBeNull()
  })
})

describe('the whole receive path', () => {
  it('turns a stream of arbitrary notification slices into messages', () => {
    const preset = quantizePreset(samplePreset())
    const wire = concat(encodeBlocks(0x03, 0x01, serializePreset(preset), { seq: 0x44 }))

    const stream = new ChunkStream()
    const assembler = new MessageAssembler()
    const messages = []

    // Slice at a width that lines up with nothing, the way BLE actually delivers.
    for (let i = 0; i < wire.length; i += 17) {
      messages.push(...assembler.acceptAll(stream.push(wire.subarray(i, i + 17))))
    }

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ type: 'preset' })
    if (messages[0]?.type === 'preset') expect(messages[0].preset).toEqual(preset)
  })
})
