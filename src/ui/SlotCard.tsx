import { memo } from 'react'
import {
  AMP_SLOT,
  BASS_AMPS,
  CATALOG,
  GUITAR_AMPS,
  knobIsNamed,
  knobLabel,
  slotSpec,
} from '../protocol/catalog.js'
import { REVERB_ROOMS, REVERB_TYPE_INDEX, labelSourceFor, reverbRoomFor } from '../protocol/knobs.js'
import type { PedalState } from '../protocol/preset.js'
import { Knob } from './Knob.js'

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
 * Parameter values travel as floats from 0 to 1 and are shown from 0 to 10,
 * which is how the amp's own knobs are marked. The conversion lives in
 * {@link Knob} and nowhere else.
 */
export const SlotCard = memo(function SlotCard({ slot, pedal, onToggle, onSwap, onParam }: Props) {
  const spec = slotSpec(slot)
  const isAmp = slot === AMP_SLOT
  const isReverb = pedal.name === 'bias.reverb'
  const models = CATALOG[slot] ?? {}
  const known = pedal.name in models
  const labels = labelSourceFor(pedal.name)

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

      {/* The reverb room is a float in one parameter rather than a model swap,
          so it gets a picker instead of a knob nobody could aim. */}
      {isReverb && pedal.params.length > REVERB_TYPE_INDEX && (
        <select
          className="room"
          aria-label="Reverb room"
          value={String(reverbRoomFor(pedal.params[REVERB_TYPE_INDEX] as number)?.value ?? '')}
          onChange={(event) => onParam(slot, REVERB_TYPE_INDEX, Number(event.target.value))}
        >
          {reverbRoomFor(pedal.params[REVERB_TYPE_INDEX] as number) === null && (
            <option value="">
              {(pedal.params[REVERB_TYPE_INDEX] as number).toFixed(3)} (between rooms)
            </option>
          )}
          {REVERB_ROOMS.map((room) => (
            <option key={room.value} value={String(room.value)}>
              {room.name}
              {room.alternative ? ` · ${room.alternative}` : ''}
            </option>
          ))}
        </select>
      )}

      {/* Knobs stay live on a bypassed slot. You dial an effect in before you
          switch it on, and the amp accepts the change either way — greying them
          out would be tidy and would get in your way. */}
      <div className="knobs">
        {pedal.params.map((value, index) => {
          if (isReverb && index === REVERB_TYPE_INDEX) return null
          return (
            <Knob
              key={index}
              label={knobLabel(slot, pedal.name, index)}
              named={knobIsNamed(slot, pedal.name, index)}
              value={value}
              onChange={(next) => onParam(slot, index, next)}
            />
          )
        })}
      </div>

      {labels?.note && <p className="slot-note">{labels.note}</p>}
    </section>
  )
})
