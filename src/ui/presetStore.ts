/**
 * Presets kept in the browser.
 *
 * A shelf you can reach in one click, alongside the four the amp holds. It is
 * per-browser and it is not a backup: clearing site data empties it, a private
 * window starts empty, and nothing here reaches another device. Files on disk
 * remain the durable copy, which is why every entry can be exported and why
 * dropping a file onto the page imports it.
 *
 * Every read and write is wrapped, because storage throws rather than returning
 * nothing when a browser has it disabled, and a page that cannot list saved
 * presets should still control an amp.
 */

import type { Preset } from '../protocol/preset.js'
import { looksLikePreset } from './files.js'

const KEY = 'spark-web.library'

export interface LibraryEntry {
  id: string
  savedAt: number
  preset: Preset
}

export function loadLibrary(): LibraryEntry[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry): entry is LibraryEntry =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as LibraryEntry).id === 'string' &&
        looksLikePreset((entry as LibraryEntry).preset),
    )
  } catch {
    return []
  }
}

function save(entries: LibraryEntry[]): LibraryEntry[] {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries))
  } catch {
    // Full, disabled or a private window. The shelf still works for this
    // session; it just will not be there next time.
  }
  return entries
}

export function addToLibrary(preset: Preset): LibraryEntry[] {
  const entry: LibraryEntry = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt: Date.now(),
    // Stored without the live marker and without a channel, because a preset on
    // the shelf belongs to no slot until you send it somewhere.
    preset: { ...stripLive(preset) },
  }
  return save([entry, ...loadLibrary()])
}

export function removeFromLibrary(id: string): LibraryEntry[] {
  return save(loadLibrary().filter((entry) => entry.id !== id))
}

export function renameInLibrary(id: string, name: string): LibraryEntry[] {
  return save(
    loadLibrary().map((entry) =>
      entry.id === id ? { ...entry, preset: { ...entry.preset, name } } : entry,
    ),
  )
}

function stripLive(preset: Preset): Preset {
  const copy: Preset = {
    ...preset,
    pedals: preset.pedals.map((p) => ({ ...p, params: [...p.params] })),
  }
  delete copy.live
  return copy
}
