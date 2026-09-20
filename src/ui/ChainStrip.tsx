import { displayName, SLOTS } from '../protocol/catalog.js'
import type { PresetDiff } from '../state/diff.js'
import type { PedalState } from '../protocol/preset.js'

interface Props {
  pedals: PedalState[]
  diff: PresetDiff
  onSelect(slot: number): void
}

/**
 * The signal chain, in order, at a glance.
 *
 * The seven slots are a fixed chain — your guitar goes through the gate, then
 * the compressor, then drive, the amp, modulation, delay and reverb, in that
 * order, always. The cards below lay out as a responsive grid, which is good for
 * reading one slot and says nothing about that order. This strip says it.
 *
 * A bypassed slot fades and its connector runs straight through, so you can see
 * what the signal actually passes on its way out. Slots you have changed since
 * the preset was stored carry a mark.
 */
export function ChainStrip({ pedals, diff, onSelect }: Props) {
  return (
    <nav className="chainstrip" aria-label="Signal chain">
      <span className="cap">IN</span>
      {pedals.map((pedal, slot) => {
        const spec = SLOTS[slot]
        const changed = diff.slots[slot]?.changed ?? false
        return (
          <span className="chainstrip-step" key={slot}>
            <span className={`wire${pedal.on ? '' : ' bypassed'}`} aria-hidden="true" />
            <button
              type="button"
              className={`node${pedal.on ? '' : ' bypassed'}${changed ? ' changed' : ''}`}
              onClick={() => onSelect(slot)}
              title={`${spec?.kind ?? ''}: ${displayName(slot, pedal.name)}${
                pedal.on ? '' : ' (bypassed)'
              }${changed ? ' · changed' : ''}`}
            >
              <span className="node-kind">{spec?.kind}</span>
              <span className="node-model">{displayName(slot, pedal.name)}</span>
            </button>
          </span>
        )
      })}
      <span className={`wire${pedals[pedals.length - 1]?.on ? '' : ' bypassed'}`} aria-hidden="true" />
      <span className="cap">OUT</span>
    </nav>
  )
}
