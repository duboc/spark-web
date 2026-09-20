import { useCallback, useId, useRef, useState } from 'react'

interface Props {
  label: string
  value: number
  /** False when no source names this parameter, so the label is just its index. */
  named?: boolean
  disabled?: boolean
  onChange(value: number): void
}

/** Degrees of travel, centred on the top. A real knob's dead zone points down. */
const SWEEP = 270
const START = 180 + (360 - SWEEP) / 2

/** Pixels of vertical drag for the full range. */
const TRAVEL = 180

/**
 * A rotary control.
 *
 * Knobs rather than sliders, because the amp has knobs and so does every guitar
 * pedal the effects are modelled on — the control should look like the thing it
 * controls. They are also considerably more compact, which matters when seven
 * slots each carry up to eight of them.
 *
 * You drag vertically, which is what every audio application does and what your
 * hands already know. Dragging in a circle looks right in a demonstration and is
 * miserable to use. Holding shift divides the movement by five for fine work.
 *
 * It is a real slider to a screen reader: arrow keys step, Home and End jump to
 * the ends, and the value is announced as it reads on the amp, 0 to 10.
 */
export function Knob({ label, value, named = true, disabled = false, onChange }: Props) {
  const id = useId()
  const [dragging, setDragging] = useState(false)
  const origin = useRef({ y: 0, value: 0 })

  const clamp = (v: number): number => Math.min(1, Math.max(0, v))

  const onPointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (disabled) return
      event.currentTarget.setPointerCapture(event.pointerId)
      origin.current = { y: event.clientY, value }
      setDragging(true)
    },
    [disabled, value],
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (!dragging) return
      const travelled = origin.current.y - event.clientY
      const scale = event.shiftKey ? TRAVEL * 5 : TRAVEL
      onChange(clamp(origin.current.value + travelled / scale))
    },
    [dragging, onChange],
  )

  const stop = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setDragging(false)
  }, [])

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<SVGSVGElement>) => {
      if (disabled) return
      const step = event.shiftKey ? 0.002 : 0.02
      const moves: Record<string, number | 'min' | 'max'> = {
        ArrowUp: step,
        ArrowRight: step,
        ArrowDown: -step,
        ArrowLeft: -step,
        PageUp: step * 5,
        PageDown: -step * 5,
        Home: 'min',
        End: 'max',
      }
      const move = moves[event.key]
      if (move === undefined) return
      event.preventDefault()
      if (move === 'min') onChange(0)
      else if (move === 'max') onChange(1)
      else onChange(clamp(value + move))
    },
    [disabled, onChange, value],
  )

  const angle = START + value * SWEEP
  const shown = (value * 10).toFixed(1)

  return (
    <div className={`knob${disabled ? ' disabled' : ''}`}>
      <svg
        viewBox="0 0 48 48"
        className={`dial${dragging ? ' dragging' : ''}`}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-labelledby={id}
        aria-valuemin={0}
        aria-valuemax={10}
        aria-valuenow={Number(shown)}
        aria-valuetext={`${label} ${shown}`}
        aria-disabled={disabled}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={stop}
        onPointerCancel={stop}
        onKeyDown={onKeyDown}
      >
        <path d={arc(START, START + SWEEP)} className="track" />
        {value > 0.001 && <path d={arc(START, angle)} className="fill" />}
        <circle cx="24" cy="24" r="13" className="cap" />
        <line
          x1={24 + 4 * Math.cos(rad(angle))}
          y1={24 + 4 * Math.sin(rad(angle))}
          x2={24 + 11 * Math.cos(rad(angle))}
          y2={24 + 11 * Math.sin(rad(angle))}
          className="pointer"
        />
      </svg>
      <span className={`knob-label${named ? '' : ' unnamed'}`} id={id} title={named ? label : 'No source names this parameter'}>
        {label}
      </span>
      <span className="knob-value">{shown}</span>
    </div>
  )
}

function rad(degrees: number): number {
  return (degrees * Math.PI) / 180
}

/** An arc of the outer ring, from one angle to another. */
function arc(from: number, to: number): string {
  const r = 19
  const x1 = 24 + r * Math.cos(rad(from))
  const y1 = 24 + r * Math.sin(rad(from))
  const x2 = 24 + r * Math.cos(rad(to))
  const y2 = 24 + r * Math.sin(rad(to))
  const large = to - from > 180 ? 1 : 0
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
}
