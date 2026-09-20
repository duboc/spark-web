import { memo } from 'react'
import { CATALOG, AMP_SLOT, knobLabel, slotSpec, GUITAR_AMPS, BASS_AMPS } from '../protocol/catalog.js'
import type { PedalState } from '../protocol/preset.js'

interface Props {
  slot: number
  pedal: PedalState
  onToggle(slot: number): void
  onSwap(slot: number, dsp: string): void
  onParam(slot: number, index: number, value: number): void
}

/**
 * One link in the chain.
 *
 * Parameter values travel as floats from 0 to 1 but are shown from 0 to 10,
 * which is what the amp's own knobs are marked with and what the official app
 * displays. The conversion lives here and nowhere else.
 */
export const SlotCard = memo(function SlotCard({ slot, pedal, onToggle, onSwap, onParam }: Props) {
  const spec = slotSpec(slot)
  const isAmp = slot === AMP_SLOT
  const models = CATALOG[slot] ?? {}
  const known = pedal.name in models

  return (
    <section className={`slot${pedal.on ? '' : ' bypassed'}${isAmp ? ' amp' : ''}`}>
      <div className="slot-head">
        <h3 className="slot-kind">{spec.kind}</h3>
        <button
          type="button"
          role="switch"
          aria-checked={pedal.on}
          aria-label={`${pedal.on ? 'Bypass' : 'Enable'} ${spec.kind}`}
          className="switch"
          onClick={() => onToggle(slot)}
        />
      </div>

      <select
        value={pedal.name}
        aria-label={`${spec.kind} model`}
        onChange={(event) => onSwap(slot, event.target.value)}
      >
        {/* A model the amp reports but the catalogue does not list still has to
            be selectable, or swapping away from it would be impossible. */}
        {!known && <option value={pedal.name}>{pedal.name} (not in catalogue)</option>}
        {isAmp ? (
          <>
            <optgroup label="Guitar">
              {Object.entries(GUITAR_AMPS).map(([dsp, label]) => (
                <option key={dsp} value={dsp}>
                  {label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Bass">
              {Object.entries(BASS_AMPS).map(([dsp, label]) => (
                <option key={dsp} value={dsp}>
                  {label}
                </option>
              ))}
            </optgroup>
          </>
        ) : (
          Object.entries(models).map(([dsp, label]) => (
            <option key={dsp} value={dsp}>
              {label}
            </option>
          ))
        )}
      </select>

      {pedal.params.map((value, index) => (
        <div className="knob" key={index}>
          <div className="knob-row">
            <span className="label">{knobLabel(slot, pedal.name, index)}</span>
            <span className="value">{(value * 10).toFixed(1)}</span>
          </div>
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(value * 1000)}
            aria-label={`${pedal.name} ${knobLabel(slot, pedal.name, index)}`}
            onChange={(event) => onParam(slot, index, Number(event.target.value) / 1000)}
          />
        </div>
      ))}
    </section>
  )
})
