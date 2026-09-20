import { useCallback, useState } from 'react'
import type { Preset } from '../protocol/preset.js'
import { savePreset } from './files.js'
import { addToLibrary, loadLibrary, removeFromLibrary, type LibraryEntry } from './presetStore.js'

interface Props {
  live: Preset | null
  onSend(preset: Preset): void
}

/**
 * The shelf.
 *
 * Presets you keep, next to the four the amp holds. Sending one puts it on the
 * amp as the live sound without overwriting anything, so you can audition a
 * dozen of them and still have your four hardware slots as you left them. That
 * separation is the point: storing to a slot is destructive and deliberate,
 * loading from the shelf is neither.
 */
export function Library({ live, onSend }: Props) {
  const [entries, setEntries] = useState<LibraryEntry[]>(() => loadLibrary())
  const [open, setOpen] = useState(false)

  const keep = useCallback(() => {
    if (live) setEntries(addToLibrary(live))
  }, [live])

  return (
    <section className="library">
      <div className="library-bar">
        <button
          type="button"
          className="small"
          aria-expanded={open}
          onClick={() => setOpen((was) => !was)}
        >
          {open ? '▾' : '▸'} Library ({entries.length})
        </button>
        <button type="button" className="small" onClick={keep} disabled={!live}>
          Keep this sound
        </button>
        <span className="hint">or drop a preset file anywhere on the page</span>
      </div>

      {open && entries.length === 0 && (
        <p className="library-empty">
          Nothing kept yet. <b>Keep this sound</b> puts the live sound here, and it stays in this
          browser — export to a file for anything you want to survive clearing site data.
        </p>
      )}

      {open && entries.length > 0 && (
        <ul className="library-list">
          {entries.map((entry) => (
            <li key={entry.id}>
              <span className="library-name" title={entry.preset.name}>
                {entry.preset.name}
              </span>
              <span className="library-when">{new Date(entry.savedAt).toLocaleDateString()}</span>
              <button type="button" className="small" onClick={() => onSend(entry.preset)}>
                Send to amp
              </button>
              <button type="button" className="small" onClick={() => savePreset(entry.preset)}>
                Export
              </button>
              <button
                type="button"
                className="small danger"
                aria-label={`Remove ${entry.preset.name}`}
                onClick={() => setEntries(removeFromLibrary(entry.id))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
