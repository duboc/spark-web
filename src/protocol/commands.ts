/**
 * App → amp commands.
 *
 * Each builder returns a {@link Command}: the framed blocks plus a label for the
 * log and a gap telling the write queue how long to wait afterwards. Building a
 * command never touches the radio — these are values, and the transport decides
 * when they go out.
 */

import { Writer } from './codec.js'
import { encodeBlocks } from './frame.js'
import { HARDWARE_PRESETS, slotSpec } from './catalog.js'
import { serializePreset, validatePreset, type Preset } from './preset.js'

export interface Command {
  label: string
  cmd: number
  sub: number
  blocks: Uint8Array[]
  /** Milliseconds to wait after writing this, before the next command goes out. */
  gapMs: number
}

/**
 * How long to wait after each kind of command.
 *
 * Community guidance is 500 ms between commands, which is unusably slow for
 * dragging a slider — a drag would feel like a series of separate decisions. The
 * values below are what the prototype used successfully, and they are gathered
 * here so that if the amp starts misbehaving the first thing to try is raising
 * them, in one place, before suspecting the parser.
 *
 * Still to be established by bisection against real hardware: how low PARAM can
 * actually go.
 */
export const GAP = {
  PARAM: 45,
  TOGGLE: 60,
  SELECT: 150,
  SWAP: 200,
  QUERY: 250,
  PRESET_QUERY: 400,
  STORE: 300,
  /** Between the blocks of one multi-block preset upload. */
  UPLOAD: 100,
} as const

function one(
  label: string,
  cmd: number,
  sub: number,
  payload: readonly number[],
  gapMs: number,
): Command {
  return { label, cmd, sub, blocks: encodeBlocks(cmd, sub, payload), gapMs }
}

/* ── queries ──────────────────────────────────────────────────────────────── */

export function requestAmpName(): Command {
  return one('get amp name', 0x02, 0x11, [], GAP.QUERY)
}

export function requestSerialNumber(): Command {
  return one('get serial number', 0x02, 0x23, [], GAP.QUERY)
}

export function requestPresetNumber(): Command {
  return one('get current preset number', 0x02, 0x10, [], GAP.QUERY)
}

export function requestPreset(slot: number): Command {
  assertHardwareSlot(slot)
  return one(`get preset ${slot + 1}`, 0x02, 0x01, [0x00, slot], GAP.PRESET_QUERY)
}

/** Ask for the live sound, which may differ from any stored preset. */
export function requestLiveState(): Command {
  return one('get live state', 0x02, 0x01, [0x01, 0x00], GAP.PRESET_QUERY)
}

/**
 * The handshake to run on connect, in order.
 *
 * Identity first, then which preset is selected, then all four stored presets,
 * then the live sound — so that by the time the live state arrives, the UI
 * already knows the names to label everything with.
 */
export function connectHandshake(): Command[] {
  return [
    requestAmpName(),
    requestSerialNumber(),
    requestPresetNumber(),
    ...Array.from({ length: HARDWARE_PRESETS }, (_, i) => requestPreset(i)),
    requestLiveState(),
  ]
}

/* ── changes ──────────────────────────────────────────────────────────────── */

export function selectPreset(slot: number): Command {
  assertHardwareSlot(slot)
  return one(`select preset ${slot + 1}`, 0x01, 0x38, [0x00, slot], GAP.SELECT)
}

/** Overwrite a hardware slot with the current sound. Destructive, and not undoable. */
export function storeToSlot(slot: number): Command {
  assertHardwareSlot(slot)
  return one(`STORE to slot ${slot + 1}`, 0x03, 0x27, [0x00, slot], GAP.STORE)
}

export function toggleEffect(name: string, on: boolean): Command {
  const payload = new Writer().pstr(name).bool(on).toBytes()
  return {
    label: `${name} ${on ? 'on' : 'off'}`,
    cmd: 0x01,
    sub: 0x15,
    blocks: encodeBlocks(0x01, 0x15, payload),
    gapMs: GAP.TOGGLE,
  }
}

/**
 * Change one knob.
 *
 * Which command byte to use depends on the slot: the amp slot answers to `03 37`
 * and everything else to `01 04`. Sending the wrong one is silently ignored, so
 * the slot is a required argument rather than something inferred from the name.
 */
export function setParam(slot: number, name: string, index: number, value: number): Command {
  const spec = slotSpec(slot)
  if (!Number.isInteger(index) || index < 0 || index > 0x7f) {
    throw new RangeError(`parameter index must be 0-127, got ${index}`)
  }
  const clamped = clampUnit(value)
  const payload = new Writer().pstr(name).u8(index).f32(clamped).toBytes()
  return {
    label: `${name} p${index} = ${clamped.toFixed(3)}`,
    cmd: spec.cmd,
    sub: spec.paramSub,
    blocks: encodeBlocks(spec.cmd, spec.paramSub, payload),
    gapMs: GAP.PARAM,
  }
}

/** Swap the model in a slot. Same command-byte rule as {@link setParam}. */
export function swapModel(slot: number, from: string, to: string): Command {
  const spec = slotSpec(slot)
  const payload = new Writer().pstr(from).pstr(to).toBytes()
  return {
    label: `${from} → ${to}`,
    cmd: spec.cmd,
    sub: spec.swapSub,
    blocks: encodeBlocks(spec.cmd, spec.swapSub, payload),
    gapMs: GAP.SWAP,
  }
}

/**
 * Upload a whole preset.
 *
 * This is the command that makes presets-as-files worth having: it is how a
 * preset held in a JSON file on disk becomes the sound coming out of the amp.
 * It is also the only command large enough to need splitting across blocks.
 *
 * The preset is validated before a single byte is framed. Malformed settings can
 * wedge the amp until it is power-cycled, and a sound that fails to load is a
 * far better outcome than an amp that needs unplugging.
 */
export function sendPreset(preset: Preset, seq = 0x01): Command {
  const problems = validatePreset(preset)
  if (problems.length > 0) {
    throw new Error(`refusing to send an invalid preset:\n  ${problems.join('\n  ')}`)
  }
  const payload = serializePreset(preset)
  return {
    label: `upload preset "${preset.name}"`,
    cmd: 0x01,
    sub: 0x01,
    blocks: encodeBlocks(0x01, 0x01, payload, { seq }),
    gapMs: GAP.UPLOAD,
  }
}

function assertHardwareSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < 0 || slot >= HARDWARE_PRESETS) {
    throw new RangeError(`hardware preset must be 0-${HARDWARE_PRESETS - 1}, got ${slot}`)
  }
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError(`parameter value must be finite, got ${value}`)
  return Math.min(1, Math.max(0, value))
}
