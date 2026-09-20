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
import type { SlotDiff } from '../state/diff.js'
import { Knob } from './Knob.js'

interface Props {
  slot: number
  pedal: PedalState
  /** What differs from the stored preset, or null when nothing does. */
  diff: SlotDiff | null
  onToggle(slot: number): void
  onSwap(slot: number, dsp: string): void
  onParam(slot: number, index: number, value: number): void
  onRevertParam(slot: number, index: number): void
  onRevertSlot(slot: number): void
}

/**
 * One link in the chain.
 *
 * Parameter values travel as floats from 0 to 1 and are shown from 0 to 10,
 * which is how the amp's own knobs are marked. The conversion lives in
 * {@link Knob} and nowhere else.
 */
export const SlotCard = memo(function SlotCard({
  slot,
  pedal,
  diff,
  onToggle,
  onSwap,
  onParam,
  onRevertParam,
  onRevertSlot,
}: Props) {
  const spec = slotSpec(slot)
  const isAmp = slot === AMP_SLOT
  const isReverb = pedal.name === 'bias.reverb'
  const models = CATALOG[slot] ?? {}
  const known = pedal.name in models
  const labels = labelSourceFor(pedal.name)

  return (
    <section
      id={`slot-${slot}`}
      className={`slot${pedal.on ? '' : ' bypassed'}${isAmp ? ' amp' : ''}${diff ? ' changed' : ''}`}
    >
      <div className="slot-head">
        <h3 className="slot-kind">{spec.kind}</h3>
        {diff && (
          <button
            type="button"
            className="revert small"
            onClick={() => onRevertSlot(slot)}
            title={describeDiff(diff)}
          >
            revert
          </button>
        )}
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
              changed={diff?.params.includes(index) ?? false}
              onRevert={() => onRevertParam(slot, index)}
              onChange={(next) => onParam(slot, index, next)}
            />
          )
        })}
      </div>

      {labels?.note && <p className="slot-note">{labels.note}</p>}
    </section>
  )
})

/** Says what changed here, for the revert button's tooltip. */
function describeDiff(diff: SlotDiff): string {
  const parts: string[] = []
  if (diff.modelChanged) parts.push('a different effect')
  if (diff.bypassChanged) parts.push('switched the other way')
  if (diff.params.length > 0) {
    parts.push(`${diff.params.length} knob${diff.params.length === 1 ? '' : 's'} moved`)
  }
  return `Changed since the preset was stored: ${parts.join(', ')}. Put it back.`
}
