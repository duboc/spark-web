/**
 * Presets and captures as files on your disk.
 *
 * This is the argument for this project over the official app. A preset here is
 * a JSON file: you can keep it in a repository, diff two of them to see what
 * actually changed between takes, and send one to somebody without an account.
 * The shape on disk is the same {@link Preset} the protocol layer round-trips,
 * so nothing is lost on the way out or back in.
 */

import type { Preset } from '../protocol/preset.js'
import type { Capture } from '../transport/recorder.js'

export function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  // Revoke on the next tick; revoking immediately can cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function savePreset(preset: Preset): void {
  downloadJson(preset, `${slug(preset.name) || 'preset'}.spark.json`)
}

export function saveCapture(capture: Capture): void {
  downloadJson(capture, `${slug(capture.title) || 'capture'}.capture.json`)
}

/** Open a file picker and return the parsed contents. Resolves null if you cancel. */
export function pickJson<T>(accept = '.json'): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (!file) {
        resolve(null)
        return
      }
      file
        .text()
        .then((text) => resolve(JSON.parse(text) as T))
        .catch(reject)
    })
    // A cancelled picker fires nothing in some browsers, so the promise simply
    // never settles. That is harmless here: nothing awaits it in a way that
    // would leak, and the alternative is a timeout that guesses.
    input.click()
  })
}

/**
 * Check that a parsed file is really a preset before it goes anywhere near the
 * amp. A file from disk is untrusted input in the same way bytes from the wire
 * are, and malformed settings can wedge the amp until it is power-cycled.
 */
export function looksLikePreset(value: unknown): value is Preset {
  if (typeof value !== 'object' || value === null) return false
  const p = value as Partial<Preset>
  return (
    typeof p.name === 'string' &&
    typeof p.bpm === 'number' &&
    Array.isArray(p.pedals) &&
    p.pedals.every(
      (pedal) =>
        typeof pedal?.name === 'string' &&
        typeof pedal?.on === 'boolean' &&
        Array.isArray(pedal?.params),
    )
  )
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
