import { describe, expect, it, vi } from 'vitest'
import { AmpController } from '../src/state/amp.js'
import { MockTransport } from '../src/transport/mock.js'

import { samplePreset } from './helpers.js'

/**
 * The whole stack, end to end: controller → queue → transport → framing →
 * parsing → state. The mock answers the way we believe the amp answers, so a
 * failure here is a failure in our own plumbing rather than a disagreement with
 * hardware. That is a narrower claim than it looks, and an important one to be
 * able to make on its own.
 */
async function connected(): Promise<{ amp: AmpController; mock: MockTransport }> {
  const mock = new MockTransport({ latencyMs: 0 })
  const amp = new AmpController({ gapScale: 0 })
  await amp.connect(mock)
  await vi.waitFor(() => expect(amp.getSnapshot().live).not.toBeNull(), { timeout: 2000 })
  return { amp, mock }
}

describe('connecting', () => {
  it('reads identity, preset names and the live sound', async () => {
    const { amp } = await connected()
    await vi.waitFor(() => {
      const snapshot = amp.getSnapshot()
      expect(snapshot.status).toBe('connected')
      expect(snapshot.deviceName).toBe('Spark 40 BLE')
      expect(snapshot.serial).toBe('MOCK-00000001')
      expect(snapshot.stored.map((p) => p?.name)).toEqual(['Clean Start', 'Crunch', 'Lead', 'Acoustic'])
      expect(snapshot.currentPreset).toBe(0)
    })
  })

  it('brings back a live sound with all seven slots', async () => {
    const { amp } = await connected()
    const live = amp.getSnapshot().live
    expect(live?.live).toBe(true)
    expect(live?.pedals).toHaveLength(7)
    expect(live?.pedals.map((p) => p.name)).toContain('bias.reverb')
  })

  it('reports a transport that refuses to connect instead of pretending', async () => {
    const amp = new AmpController({ gapScale: 0 })
    await amp.connect({
      label: 'broken',
      connected: false,
      connect: () => Promise.reject(new Error('no such device')),
      disconnect: () => Promise.resolve(),
      write: () => Promise.resolve(),
      listen: () => () => undefined,
    })
    expect(amp.getSnapshot().status).toBe('disconnected')
    expect(amp.getSnapshot().error).toBe('no such device')
  })
})

describe('changing the sound', () => {
  it('selects a preset and the live sound follows', async () => {
    const { amp } = await connected()
    amp.selectPreset(2)
    await vi.waitFor(() => expect(amp.getSnapshot().live?.name).toBe('Lead'))
    expect(amp.getSnapshot().currentPreset).toBe(2)
  })

  it('moves a knob locally before the amp has said anything', async () => {
    // The amp never acknowledges a parameter change, so an interface that waits
    // for confirmation waits for ever.
    const { amp } = await connected()
    amp.setParam(3, 0, 0.9)
    expect(amp.getSnapshot().live?.pedals[3]?.params[0]).toBe(0.9)
  })

  it('reaches the amp with the knob change', async () => {
    const { amp, mock } = await connected()
    const name = amp.getSnapshot().live?.pedals[3]?.name as string
    amp.setParam(3, 1, 0.25)
    await vi.waitFor(() =>
      expect(mock.liveState.pedals.find((p) => p.name === name)?.params[1]).toBeCloseTo(0.25, 5),
    )
  })

  it('toggles a slot in both places', async () => {
    const { amp, mock } = await connected()
    const before = amp.getSnapshot().live?.pedals[5]?.on
    const name = amp.getSnapshot().live?.pedals[5]?.name as string
    amp.toggleSlot(5)
    expect(amp.getSnapshot().live?.pedals[5]?.on).toBe(!before)
    await vi.waitFor(() => expect(mock.liveState.pedals.find((p) => p.name === name)?.on).toBe(!before))
  })

  it('swaps a model and picks up the parameters the new one brings', async () => {
    const { amp } = await connected()
    amp.swapModel(3, 'Plexi')
    await vi.waitFor(() => expect(amp.getSnapshot().live?.pedals[3]?.name).toBe('Plexi'))
    expect(amp.getSnapshot().live?.pedals[3]?.params.length).toBeGreaterThan(0)
  })

  it('drops queued positions for a knob that has since moved again', async () => {
    // Dragging a slider produces more positions than the amp can take. Only the
    // newest one is worth sending.
    const mock = new MockTransport({ latencyMs: 0 })
    const amp = new AmpController({ gapScale: 1 })
    await amp.connect(mock)
    await vi.waitFor(() => expect(amp.getSnapshot().live).not.toBeNull(), { timeout: 2000 })

    for (let i = 0; i <= 20; i++) amp.setParam(3, 0, i / 20)
    const depth = amp.getSnapshot().queueDepth
    expect(depth).toBeLessThan(20)
  })
})

describe('storing and uploading', () => {
  it('stores the live sound into a hardware slot', async () => {
    const { amp, mock } = await connected()
    amp.selectPreset(1)
    await vi.waitFor(() => expect(amp.getSnapshot().live?.name).toBe('Crunch'))
    amp.storeToSlot(3)
    await vi.waitFor(() => expect(mock.storedPresets[3]?.name).toBe('Crunch'))
    await vi.waitFor(() => expect(amp.getSnapshot().stored[3]?.name).toBe('Crunch'))
  })

  it('uploads a preset built from nothing, across several blocks', async () => {
    // This is the reason the project exists: a preset that lived in a file is
    // now the sound coming out of the amp.
    const { amp, mock } = await connected()
    amp.uploadPreset(samplePreset({ name: 'From A File' }))
    await vi.waitFor(() => expect(mock.liveState.name).toBe('From A File'), { timeout: 3000 })
    expect(mock.liveState.pedals.map((p) => p.name)).toEqual(
      samplePreset().pedals.map((p) => p.name),
    )
  })

  it('refuses to upload a preset that would not be safe to send', async () => {
    const { amp, mock } = await connected()
    const broken = samplePreset({ name: 'Broken' })
    broken.pedals[3]!.params[0] = 12
    amp.uploadPreset(broken)
    await new Promise((r) => setTimeout(r, 50))
    expect(mock.liveState.name).not.toBe('Broken')
    expect(amp.getSnapshot().log.some((l) => l.kind === 'error')).toBe(true)
  })
})

describe('the amp pushing changes at us', () => {
  it('follows a knob turned on the front panel', async () => {
    const { amp, mock } = await connected()
    const name = amp.getSnapshot().live?.pedals[3]?.name as string
    mock.turnKnob(name, 2, 0.875)
    await vi.waitFor(() => expect(amp.getSnapshot().live?.pedals[3]?.params[2]).toBeCloseTo(0.875, 5))
  })

  it('follows a preset button pressed on the front panel', async () => {
    const { amp, mock } = await connected()
    mock.pressPreset(3)
    await vi.waitFor(() => expect(amp.getSnapshot().currentPreset).toBe(3))
    await vi.waitFor(() => expect(amp.getSnapshot().live?.name).toBe('Acoustic'))
  })
})

describe('capture', () => {
  it('records both directions so a session can become a fixture', async () => {
    const { amp } = await connected()
    amp.setParam(3, 0, 0.5)
    await vi.waitFor(() => expect((amp.exportCapture('test')?.events.length ?? 0) > 4).toBe(true))

    const capture = amp.exportCapture('handshake and one knob')
    expect(capture?.title).toBe('handshake and one knob')
    expect(capture?.device).toBe('Spark 40 BLE (mock)')
    expect(capture?.events.some((e) => e.direction === 'tx')).toBe(true)
    expect(capture?.events.some((e) => e.direction === 'rx')).toBe(true)
    // Hex, so the file is readable and a diff means something.
    expect(capture?.events[0]?.bytes).toMatch(/^[0-9a-f]{2}( [0-9a-f]{2})*$/)
  })
})

describe('disconnecting', () => {
  it('goes quiet and forgets the link', async () => {
    const { amp } = await connected()
    await amp.disconnect()
    expect(amp.getSnapshot().status).toBe('disconnected')
  })
})
