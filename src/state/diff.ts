/**
 * What you have changed since the preset was stored.
 *
 * The amp has no idea. It holds one live sound and four stored presets and will
 * not tell you how far apart they are. But this application already holds both —
 * the handshake reads all four presets, and every change is applied to the live
 * state — so the comparison is a pure function over data already in memory.
 *
 * This is the part of the project the official app has no answer to, and it
 * falls out of treating a preset as data rather than as a thing inside an amp.
 */

import type { Preset } from '../protocol/preset.js'

/**
 * How close two parameters have to be to count as unchanged.
 *
 * Values arrive from the amp as 32-bit floats and are set locally as 64-bit
 * ones, so a value that made the round trip is never bit-identical to the one
 * that was sent. A knob shows one decimal place of a 0-10 scale, so anything
 * below 0.0005 of the 0-1 range cannot be seen and should not be reported.
 */
const EPSILON = 5e-4

export interface SlotDiff {
  slot: number
  /** A different effect sits in this slot. */
  modelChanged: boolean
  /** The slot is switched the other way. */
  bypassChanged: boolean
  /** Indices of the parameters that moved. */
  params: number[]
  /** True when any of the above is true. */
  changed: boolean
}

export interface PresetDiff {
  slots: SlotDiff[]
  /** Every individual difference, counted. */
  count: number
  /** Which stored preset this was compared against. */
  against: number | null
}

const NO_DIFF: PresetDiff = { slots: [], count: 0, against: null }

/**
 * Compare the live sound against the preset it came from.
 *
 * Returns nothing to report when either side is missing, or when the models in
 * a slot differ — a different effect has different parameters, so comparing
 * them index by index would report every knob as changed and say nothing.
 */
export function diffPresets(live: Preset | null, stored: Preset | null): PresetDiff {
  if (!live || !stored) return NO_DIFF

  const slots: SlotDiff[] = []
  let count = 0

  for (let slot = 0; slot < live.pedals.length; slot++) {
    const a = live.pedals[slot]
    const b = stored.pedals[slot]
    if (!a || !b) continue

    const modelChanged = a.name !== b.name
    const bypassChanged = a.on !== b.on
    const params: number[] = []

    if (!modelChanged) {
      const longest = Math.max(a.params.length, b.params.length)
      for (let i = 0; i < longest; i++) {
        const left = a.params[i]
        const right = b.params[i]
        if (left === undefined || right === undefined) continue
        if (Math.abs(left - right) > EPSILON) params.push(i)
      }
    }

    const changed = modelChanged || bypassChanged || params.length > 0
    if (changed) count += (modelChanged ? 1 : 0) + (bypassChanged ? 1 : 0) + params.length

    slots.push({ slot, modelChanged, bypassChanged, params, changed })
  }

  return { slots, count, against: stored.channel }
}

/** The differences for one slot, or null when there are none. */
export function slotDiff(diff: PresetDiff, slot: number): SlotDiff | null {
  const found = diff.slots[slot]
  return found?.changed ? found : null
}

/** Whether one parameter differs from the stored preset. */
export function paramChanged(diff: PresetDiff, slot: number, index: number): boolean {
  return diff.slots[slot]?.params.includes(index) ?? false
}
