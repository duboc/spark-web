import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { ChunkStream, splitChunkData, xorChecksum } from '../src/protocol/frame.js'
import { MessageAssembler } from '../src/protocol/messages.js'
import { dec7, fromHex } from '../src/protocol/codec.js'
import type { Capture } from '../src/transport/recorder.js'
import type { AmpMessage } from '../src/protocol/messages.js'

/**
 * Bytes from a real Spark 40.
 *
 * Every other test in this suite drives this project's encoder against its own
 * decoder, which shows the two halves agree and says nothing about whether
 * either agrees with the amp. This file is the one that closes that gap, so it
 * is the one to trust when it disagrees with the others.
 *
 * The capture is three connect handshakes against a Spark 40, serial
 * S040CD381342: the amp's name, its serial number, which preset was selected,
 * all four stored presets, and the live state. 114 notifications, 234 chunks.
 *
 * Three things in here contradict the community documentation this project was
 * built from, and each one is asserted below so that a well-meaning "fix" to the
 * protocol layer fails loudly:
 *
 *  1. The `[total, index, count]` chunk header sits inside the 7-bit encoded
 *     region, not outside it, and `count` counts decoded bytes.
 *  2. The preset checksum is a plain sum. There is no 0xCC substitution.
 *  3. The live-state reply begins with `01` where a stored preset begins `00`.
 */

const capture = JSON.parse(
  readFileSync(new URL('./fixtures/spark40-handshake-and-presets.capture.json', import.meta.url), 'utf8'),
) as Capture

function replay(): AmpMessage[] {
  const stream = new ChunkStream()
  const assembler = new MessageAssembler()
  return capture.events
    .filter((event) => event.direction === 'rx')
    .flatMap((event) => assembler.acceptAll(stream.push(fromHex(event.bytes))))
}

function chunks() {
  const stream = new ChunkStream()
  return capture.events
    .filter((event) => event.direction === 'rx')
    .flatMap((event) => stream.push(fromHex(event.bytes)))
}

describe('reading a real session', () => {
  it('finds every chunk the amp sent', () => {
    expect(chunks()).toHaveLength(234)
  })

  it('reads every message, leaving none unrecognised', () => {
    const messages = replay()
    const unread = messages.filter((m) => m.type === 'unknown')
    expect(unread.map((m) => (m.type === 'unknown' ? m.reason : ''))).toEqual([])
    expect(messages.length).toBeGreaterThan(20)
  })

  it('reads the amp name and serial number', () => {
    const messages = replay()
    expect(messages.find((m) => m.type === 'ampName')).toMatchObject({ name: 'Spark 40' })
    expect(messages.find((m) => m.type === 'serialNumber')?.type).toBe('serialNumber')
  })

  it('reads which preset was selected', () => {
    expect(replay().find((m) => m.type === 'presetNumber')).toMatchObject({ preset: 0 })
  })

  it('reads all four stored presets by name', () => {
    const stored = replay()
      .filter((m): m is Extract<AmpMessage, { type: 'preset' }> => m.type === 'preset')
      .filter((m) => !m.preset.live)
    const names = [...new Set(stored.map((m) => m.preset.name))]
    expect(names).toEqual(['1-Clean', '2-Crunch', '3-HighGain', '4-Metal'])
    expect([...new Set(stored.map((m) => m.preset.channel))]).toEqual([0, 1, 2, 3])
  })

  it('tells the live state apart from a stored preset', () => {
    // The live reply starts with 01 where a stored preset starts with 00.
    const live = replay().filter((m) => m.type === 'preset' && m.preset.live)
    expect(live.length).toBeGreaterThan(0)
  })

  it('gives every preset seven slots', () => {
    for (const message of replay()) {
      if (message.type !== 'preset') continue
      expect(message.preset.pedals, message.preset.name).toHaveLength(7)
    }
  })
})

describe('what the hardware settles', () => {
  it('puts the multi-chunk header inside the encoded region', () => {
    // Decoding first and then reading the header gives a coherent [total,
    // index, count]; reading it from the raw body does not.
    const presetChunks = chunks().filter((c) => c.cmd === 0x03 && c.sub === 0x01)
    expect(presetChunks.length).toBeGreaterThan(0)

    for (const chunk of presetChunks) {
      const decoded = dec7(chunk.body)
      const split = splitChunkData(decoded)
      expect(split.hasHeader, 'header found after decoding').toBe(true)
      expect(split.total).toBe(15)
      expect(split.index).toBeLessThan(15)
      // count is the number of decoded bytes after the header
      expect(decoded[2]).toBe(decoded.length - 3)
    }
  })

  it('carries no header on single-chunk replies', () => {
    for (const chunk of chunks()) {
      if (chunk.cmd === 0x03 && chunk.sub === 0x01) continue
      expect(splitChunkData(dec7(chunk.body)).hasHeader, `cmd ${chunk.cmd} sub ${chunk.sub}`).toBe(false)
    }
  })

  it('computes the chunk checksum as the exclusive or of the body', () => {
    for (const chunk of chunks()) {
      expect(xorChecksum(chunk.body)).toBe(chunk.checksum)
    }
  })

  it('uses one sequence byte for everything, so it cannot group chunks', () => {
    // Worth asserting because it is the opposite of what you would assume, and
    // an assembler keyed on the sequence byte would appear to work.
    expect(new Set(chunks().map((c) => c.seq))).toEqual(new Set([0x3a]))
  })

  it('checksums a preset with a plain sum, not the documented 0xCC rule', () => {
    const presets = replay().filter((m) => m.type === 'preset')
    expect(presets.length).toBeGreaterThan(0)
    for (const message of presets) {
      if (message.type !== 'preset') continue
      expect(message.checksumOk, message.preset.name).toBe(true)
    }
  })

  it('keeps every block within the documented ceiling', () => {
    for (const event of capture.events) {
      if (event.direction !== 'rx') continue
      const bytes = fromHex(event.bytes)
      for (let i = 0; i + 6 < bytes.length; i++) {
        if (bytes[i] === 0x01 && bytes[i + 1] === 0xfe) expect(bytes[i + 6]).toBeLessThanOrEqual(0x6a)
      }
    }
  })
})

describe('parameter counts, measured', () => {
  /**
   * How many parameters each effect actually has on this firmware.
   *
   * These are counted from the presets above, not taken from documentation. Two
   * entries are ranges because this capture only contains four presets and the
   * same effect appeared with different counts, which is itself worth knowing.
   */
  it('matches what the four presets contain', () => {
    const counts = new Map<string, Set<number>>()
    for (const message of replay()) {
      if (message.type !== 'preset') continue
      for (const pedal of message.preset.pedals) {
        if (!counts.has(pedal.name)) counts.set(pedal.name, new Set())
        counts.get(pedal.name)?.add(pedal.params.length)
      }
    }

    const measured = Object.fromEntries(
      [...counts].sort().map(([name, seen]) => [name, [...seen].sort((a, b) => a - b)]),
    )

    expect(measured).toEqual({
      'AC Boost': [5],
      Booster: [1],
      ChorusAnalog: [4],
      Cloner: [2],
      Compressor: [2],
      DelayMono: [5],
      DistortionTS9: [3, 4],
      Flanger: [3],
      Phaser: [2],
      Plexi: [5],
      Rectifier: [5],
      Twin: [5],
      'bias.noisegate': [3],
      'bias.reverb': [7, 8],
    })
  })
})
