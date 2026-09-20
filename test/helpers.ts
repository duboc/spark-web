import type { Preset } from '../src/protocol/preset.js'
import { LIVE_CHANNEL } from '../src/protocol/catalog.js'

/**
 * A preset shaped like one the amp would send: seven slots in chain order, with
 * parameter counts in the range the hardware actually uses.
 *
 * This stands in until captures from real hardware land in `test/fixtures/`. It
 * proves the code is self-consistent, which is worth having, but it cannot prove
 * we read the amp correctly — only bytes from the amp can do that. Treat a green
 * suite built on this as necessary, not sufficient.
 */
export function samplePreset(overrides: Partial<Preset> = {}): Preset {
  return {
    channel: LIVE_CHANNEL,
    uuid: '2c3f3ef5-6a7f-4a49-9f23-63a1b1c2d3e4',
    name: 'Test Tone',
    version: '0.7',
    description: 'a preset that exists only in the test suite',
    icon: 'icon.png',
    bpm: 120,
    pedals: [
      { name: 'bias.noisegate', on: true, params: [0.2, 0.35] },
      { name: 'LA2AComp', on: false, params: [0.5, 0.5] },
      { name: 'DistortionTS9', on: true, params: [0.3, 0.6, 0.45] },
      { name: 'Twin', on: true, params: [0.65, 0.5, 0.5, 0.45, 0.7] },
      { name: 'ChorusAnalog', on: false, params: [0.4, 0.5, 0.5, 0.5] },
      { name: 'DelayMono', on: true, params: [0.25, 0.4, 0.3, 0.5, 0.35] },
      { name: 'bias.reverb', on: true, params: [0.3, 0.5, 0.4, 0.5, 0.5, 0.5, 0.125] },
    ],
    ...overrides,
  }
}

/** Float32 loses precision, so preset round-trip comparisons go through it too. */
export function toFloat32(value: number): number {
  return Math.fround(value)
}

export function quantizePreset(preset: Preset): Preset {
  return {
    ...preset,
    bpm: toFloat32(preset.bpm),
    pedals: preset.pedals.map((p) => ({ ...p, params: p.params.map(toFloat32) })),
    ...(preset.loudness === undefined ? {} : { loudness: toFloat32(preset.loudness) }),
    ...(preset.extraGain === undefined ? {} : { extraGain: toFloat32(preset.extraGain) }),
  }
}
