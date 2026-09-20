import { describe, expect, it } from 'vitest'
import { diffPresets, paramChanged, slotDiff } from '../src/state/diff.js'
import { samplePreset } from './helpers.js'

/** A live copy of a stored preset, before anything is touched. */
function pair() {
  const stored = samplePreset({ channel: 1 })
  const live = { ...samplePreset({ channel: 1, live: true }) }
  live.pedals = live.pedals.map((p) => ({ ...p, params: [...p.params] }))
  return { stored, live }
}

describe('nothing changed', () => {
  it('reports no differences between a preset and its own copy', () => {
    const { stored, live } = pair()
    expect(diffPresets(live, stored).count).toBe(0)
  })

  it('ignores a difference too small to see', () => {
    // A knob shows one decimal of a 0-10 scale, and a value that made the round
    // trip through a 32-bit float is never bit-identical to the one sent.
    const { stored, live } = pair()
    live.pedals[3]!.params[0] = (stored.pedals[3]!.params[0] as number) + 1e-7
    expect(diffPresets(live, stored).count).toBe(0)
  })

  it('reports nothing when either side is missing', () => {
    const { stored } = pair()
    expect(diffPresets(null, stored).count).toBe(0)
    expect(diffPresets(stored, null).count).toBe(0)
    expect(diffPresets(null, null).against).toBeNull()
  })

  it('does not care that one is the live state and the other is stored', () => {
    const { stored, live } = pair()
    expect(live.live).toBe(true)
    expect(stored.live).toBeUndefined()
    expect(diffPresets(live, stored).count).toBe(0)
  })
})

describe('something changed', () => {
  it('finds a moved knob and names its index', () => {
    const { stored, live } = pair()
    live.pedals[3]!.params[1] = 0.9
    const diff = diffPresets(live, stored)
    expect(diff.count).toBe(1)
    expect(paramChanged(diff, 3, 1)).toBe(true)
    expect(paramChanged(diff, 3, 0)).toBe(false)
    expect(slotDiff(diff, 3)?.params).toEqual([1])
  })

  it('finds a slot switched the other way', () => {
    const { stored, live } = pair()
    live.pedals[5]!.on = !stored.pedals[5]!.on
    const diff = diffPresets(live, stored)
    expect(diff.count).toBe(1)
    expect(slotDiff(diff, 5)?.bypassChanged).toBe(true)
  })

  it('finds a different effect in a slot', () => {
    const { stored, live } = pair()
    live.pedals[2]!.name = 'Fuzz'
    expect(slotDiff(diffPresets(live, stored), 2)?.modelChanged).toBe(true)
  })

  it('does not compare knobs across different effects', () => {
    // A different effect has different parameters, so comparing them index by
    // index would mark every knob as changed and tell you nothing.
    const { stored, live } = pair()
    live.pedals[2]!.name = 'Fuzz'
    live.pedals[2]!.params = [0.1, 0.9]
    const diff = slotDiff(diffPresets(live, stored), 2)
    expect(diff?.modelChanged).toBe(true)
    expect(diff?.params).toEqual([])
  })

  it('counts several changes across several slots', () => {
    const { stored, live } = pair()
    live.pedals[0]!.params[0] = 0.99
    live.pedals[3]!.params[0] = 0.99
    live.pedals[3]!.params[4] = 0.01
    live.pedals[6]!.on = !stored.pedals[6]!.on
    const diff = diffPresets(live, stored)
    expect(diff.count).toBe(4)
    expect(diff.slots.filter((s) => s.changed)).toHaveLength(3)
  })

  it('says which stored preset it compared against', () => {
    const { stored, live } = pair()
    expect(diffPresets(live, stored).against).toBe(1)
  })

  it('leaves a slot alone when the other side has fewer parameters', () => {
    const { stored, live } = pair()
    live.pedals[4]!.params = [...live.pedals[4]!.params, 0.5]
    expect(slotDiff(diffPresets(live, stored), 4)).toBeNull()
  })
})
