import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { AMP_SLOT, CATALOG, SLOTS, isKnownModel } from '../src/protocol/catalog.js'
import { parsePreset, serializePreset, validatePreset, type Preset } from '../src/protocol/preset.js'
import { MAX_BLOCK_TO_AMP } from '../src/protocol/frame.js'
import { sendPreset } from '../src/protocol/commands.js'
import { ChunkStream, MessageAssembler } from '../src/protocol/index.js'
import { fromHex } from '../src/protocol/codec.js'
import type { Capture } from '../src/transport/recorder.js'
import { quantizePreset } from './helpers.js'

/**
 * The presets shipped in `presets/`.
 *
 * These are files a person will load onto an amp, so they get checked the way
 * anything crossing that boundary gets checked. The interesting test is the
 * last one: every effect a shipped preset uses must carry a parameter count
 * that a real Spark 40 has actually produced, taken from the capture rather
 * than from anybody's idea of how many knobs a Tube Screamer has.
 */

const dir = fileURLToPath(new URL('../presets/', import.meta.url))
const files = readdirSync(dir).filter((name) => name.endsWith('.json'))

const presets: Array<{ file: string; preset: Preset }> = files.map((file) => ({
  file,
  preset: JSON.parse(readFileSync(new URL(file, new URL('../presets/', import.meta.url)), 'utf8')) as Preset,
}))

/** Parameter counts this amp has been seen to use, per effect. */
const observed = ((): Map<string, Set<number>> => {
  const capture = JSON.parse(
    readFileSync(new URL('./fixtures/spark40-handshake-and-presets.capture.json', import.meta.url), 'utf8'),
  ) as Capture
  const stream = new ChunkStream()
  const assembler = new MessageAssembler()
  const counts = new Map<string, Set<number>>()

  for (const event of capture.events) {
    if (event.direction !== 'rx') continue
    for (const message of assembler.acceptAll(stream.push(fromHex(event.bytes)))) {
      if (message.type !== 'preset') continue
      for (const pedal of message.preset.pedals) {
        if (!counts.has(pedal.name)) counts.set(pedal.name, new Set())
        counts.get(pedal.name)?.add(pedal.params.length)
      }
    }
  }
  return counts
})()

describe('the shipped presets', () => {
  it('ships four of them', () => {
    expect(files).toHaveLength(4)
  })

  it.each(presets)('$file is valid', ({ preset }) => {
    expect(validatePreset(preset)).toEqual([])
  })

  it.each(presets)('$file fills all seven slots with catalogued models', ({ preset }) => {
    expect(preset.pedals).toHaveLength(SLOTS.length)
    preset.pedals.forEach((pedal, slot) => {
      expect(isKnownModel(slot, pedal.name), `slot ${slot}: ${pedal.name}`).toBe(true)
      expect(Object.keys(CATALOG[slot] ?? {})).toContain(pedal.name)
    })
  })

  it.each(presets)('$file survives the wire and comes back the same', ({ preset }) => {
    const quantized = quantizePreset(preset)
    expect(parsePreset(serializePreset(quantized))).toEqual(quantized)
  })

  it.each(presets)('$file fits in blocks the amp accepts', ({ preset }) => {
    const command = sendPreset(preset)
    expect(command.blocks.length).toBeGreaterThan(1)
    for (const block of command.blocks) expect(block.length).toBeLessThanOrEqual(MAX_BLOCK_TO_AMP)
  })

  it.each(presets)('$file has a name the amp can encode', ({ preset }) => {
    // Names go on the wire as a short string, which tops out at 31 bytes.
    expect(new TextEncoder().encode(preset.name).length).toBeLessThanOrEqual(31)
  })

  it('gives every preset a distinct uuid, so files diff cleanly', () => {
    const uuids = presets.map(({ preset }) => preset.uuid)
    expect(new Set(uuids).size).toBe(uuids.length)
  })

  it.each(presets)('$file uses parameter counts the hardware has produced', ({ preset }) => {
    preset.pedals.forEach((pedal, slot) => {
      // Every amp model carries the same five knobs, so the amp slot is checked
      // against that rather than against the four models in the capture.
      if (slot === AMP_SLOT) {
        expect(pedal.params.length, pedal.name).toBe(5)
        return
      }
      const seen = observed.get(pedal.name)
      expect(seen, `${pedal.name} does not appear in the capture, so its shape is a guess`).toBeDefined()
      expect([...(seen ?? [])], `${pedal.name}`).toContain(pedal.params.length)
    })
  })
})
