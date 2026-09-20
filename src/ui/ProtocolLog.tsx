import { useEffect, useRef } from 'react'
import type { LogEntry } from '../state/amp.js'

interface Props {
  entries: LogEntry[]
  open: boolean
  raw: boolean
  recordedEvents: number
  onToggleOpen(open: boolean): void
  onToggleRaw(raw: boolean): void
  onClear(): void
  onSaveCapture(): void
}

/**
 * What went over the wire.
 *
 * Switching on raw hex is how a session becomes evidence. The open questions in
 * this protocol — where the chunk header sits, whether the amp validates the
 * sequence and checksum bytes, what a real preset's checksum is — are all
 * answered by reading actual bytes, so the log is a tool rather than decoration.
 */
export function ProtocolLog({
  entries,
  open,
  raw,
  recordedEvents,
  onToggleOpen,
  onToggleRaw,
  onClear,
  onSaveCapture,
}: Props) {
  const box = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  // Follow the tail, unless you have scrolled up to read something.
  useEffect(() => {
    const element = box.current
    if (element && pinned.current) element.scrollTop = element.scrollHeight
  }, [entries])

  return (
    <div className="logwrap">
      <div className="logbar">
        <label>
          <input type="checkbox" checked={open} onChange={(e) => onToggleOpen(e.target.checked)} />
          Protocol log
        </label>
        <label>
          <input type="checkbox" checked={raw} onChange={(e) => onToggleRaw(e.target.checked)} />
          Raw hex
        </label>
        <span className="spacer" />
        <span>{recordedEvents} recorded</span>
        <button type="button" className="small" onClick={onSaveCapture} disabled={recordedEvents === 0}>
          Save capture
        </button>
        <button type="button" className="small" onClick={onClear}>
          Clear
        </button>
      </div>

      {open && (
        <div
          className="log"
          ref={box}
          onScroll={(event) => {
            const el = event.currentTarget
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
          }}
        >
          {entries.map((entry) => (
            <div key={entry.id} className={entry.kind}>
              {entry.text}
              {entry.raw && <span className="raw">{entry.raw}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
