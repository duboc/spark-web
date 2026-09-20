/**
 * The single source of truth.
 *
 * Two things change this state: what you do in the interface, and what the amp
 * says. Both land here, and the order matters — your change is applied
 * immediately and the amp's reply corrects it afterwards if they disagree.
 *
 * That optimism is deliberate. A slider that waits for a round trip before it
 * moves feels broken at any realistic latency, and the amp does not acknowledge
 * parameter changes at all, so a reply-driven interface would wait for a message
 * that never comes. Instead the interface renders your intent at once, and the
 * amp's own messages — a knob turned on the front panel, a preset button
 * pressed, an effect toggled — are applied the same way, which is what makes the
 * page follow the hardware when somebody touches it.
 */

import {
  ChunkStream,
  MessageAssembler,
  describe as describeMessage,
  hex,
  type AmpMessage,
} from '../protocol/index.js'
import * as cmd from '../protocol/commands.js'
import { AMP_SLOT, HARDWARE_PRESETS, LIVE_CHANNEL, SLOT_COUNT } from '../protocol/catalog.js'
import { newUuid, validatePreset, type Preset } from '../protocol/preset.js'
import { WriteQueue } from '../transport/queue.js'
import { RecordingTransport, type Capture } from '../transport/recorder.js'
import type { Transport } from '../transport/types.js'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected'

export interface LogEntry {
  id: number
  at: number
  kind: 'tx' | 'rx' | 'event' | 'error'
  text: string
  raw?: string
}

export interface AmpSnapshot {
  status: ConnectionStatus
  transportLabel: string | null
  deviceName: string | null
  serial: string | null
  /**
   * The four stored presets, whole, as far as we have been told.
   *
   * Kept complete rather than as names alone, because holding both these and
   * the live sound is what lets the interface show what you have changed since
   * the preset was stored. See state/diff.ts.
   */
  stored: (Preset | null)[]
  currentPreset: number | null
  /** The sound coming out of the amp right now. */
  live: Preset | null
  bpm: number | null
  log: LogEntry[]
  queueDepth: number
  error: string | null
  recordedEvents: number
}

const MAX_LOG = 500

const EMPTY: AmpSnapshot = {
  status: 'disconnected',
  transportLabel: null,
  deviceName: null,
  serial: null,
  stored: [null, null, null, null],
  currentPreset: null,
  live: null,
  bpm: null,
  log: [],
  queueDepth: 0,
  error: null,
  recordedEvents: 0,
}

export interface AmpControllerOptions {
  /**
   * Multiplies every inter-command gap. The tests run at 0 so they take
   * milliseconds instead of minutes; the interface leaves it at 1 and raising it
   * is the first thing to try if the amp turns flaky.
   */
  gapScale?: number
}

export class AmpController {
  #snapshot: AmpSnapshot = EMPTY
  readonly #subscribers = new Set<() => void>()
  readonly #gapScale: number

  constructor(options: AmpControllerOptions = {}) {
    this.#gapScale = options.gapScale ?? 1
  }

  #transport: RecordingTransport | null = null
  #queue: WriteQueue | null = null
  #unlisten: (() => void) | null = null
  readonly #stream = new ChunkStream()
  readonly #assembler = new MessageAssembler()
  #logId = 0
  #uploadSeq = 0x10

  /** Whether raw hex goes into the log. Verbose, and exactly what you want while capturing. */
  rawLogging = false

  subscribe = (listener: () => void): (() => void) => {
    this.#subscribers.add(listener)
    return () => this.#subscribers.delete(listener)
  }

  getSnapshot = (): AmpSnapshot => this.#snapshot

  /* ── connection ─────────────────────────────────────────────────────────── */

  async connect(transport: Transport): Promise<void> {
    await this.disconnect()

    const recording = new RecordingTransport(transport)
    this.#transport = recording
    this.#patch({ status: 'connecting', error: null, transportLabel: transport.label })

    this.#unlisten = recording.listen({
      data: (bytes) => this.#onData(bytes),
      disconnected: (reason) => this.#onDisconnected(reason),
    })

    try {
      const info = await recording.connect()
      this.#stream.reset()
      this.#assembler.reset()
      this.#queue = new WriteQueue(recording, {
        gapScale: this.#gapScale,
        onSent: (command) => {
          this.#log('tx', command.label, this.rawLogging ? command.blocks.map(hex).join('\n') : undefined)
          this.#patch({ queueDepth: this.#queue?.depth ?? 0 })
        },
        onError: (command, error) => {
          this.#log('error', `write failed: ${command.label} — ${messageOf(error)}`)
        },
      })
      this.#patch({ status: 'connected', deviceName: info.name })
      this.#log('event', `connected to ${info.name}`)
      this.refresh()
    } catch (error) {
      this.#patch({ status: 'disconnected', error: messageOf(error), transportLabel: null })
      this.#log('error', `connect failed: ${messageOf(error)}`)
      this.#transport = null
    }
  }

  async disconnect(): Promise<void> {
    this.#unlisten?.()
    this.#unlisten = null
    this.#queue?.clear()
    this.#queue = null
    const transport = this.#transport
    this.#transport = null
    if (transport) await transport.disconnect().catch(() => undefined)
    this.#patch({ status: 'disconnected', transportLabel: null, queueDepth: 0 })
  }

  /** Ask the amp for everything again. */
  refresh(): void {
    this.#send(...cmd.connectHandshake())
  }

  /* ── commands ───────────────────────────────────────────────────────────── */

  selectPreset(slot: number): void {
    this.#patch({ currentPreset: slot })
    this.#send(cmd.selectPreset(slot), cmd.requestLiveState())
  }

  /** Overwrite a hardware slot with the live sound. Destructive; confirm before calling. */
  storeToSlot(slot: number): void {
    this.#send(cmd.storeToSlot(slot), cmd.requestPreset(slot))
    this.#log('event', `storing the live sound to slot ${slot + 1}`)
  }

  toggleSlot(slot: number): void {
    const pedal = this.#snapshot.live?.pedals[slot]
    if (!pedal) return
    const on = !pedal.on
    this.#updateLive((live) => {
      const pedals = [...live.pedals]
      pedals[slot] = { ...pedal, on }
      return { ...live, pedals }
    })
    this.#send(cmd.toggleEffect(pedal.name, on))
  }

  setParam(slot: number, index: number, value: number): void {
    const pedal = this.#snapshot.live?.pedals[slot]
    if (!pedal) return

    this.#updateLive((live) => {
      const pedals = [...live.pedals]
      const params = [...pedal.params]
      params[index] = value
      pedals[slot] = { ...pedal, params }
      return { ...live, pedals }
    })

    // A drag produces far more positions than the amp can take. Everything still
    // queued for this same knob is stale the moment a newer value arrives, so
    // drop it rather than making the amp chase the pointer.
    const prefix = `${pedal.name} p${index} =`
    this.#queue?.drop((queued) => queued.label.startsWith(prefix))
    this.#send(cmd.setParam(slot, pedal.name, index, value))
  }

  swapModel(slot: number, to: string): void {
    const pedal = this.#snapshot.live?.pedals[slot]
    if (!pedal || pedal.name === to) return
    this.#send(cmd.swapModel(slot, pedal.name, to))
    // The new model has its own parameters, and we do not know them until the
    // amp says so, so ask rather than guess at a parameter list.
    this.#send(cmd.requestLiveState())
  }

  /* ── putting things back ────────────────────────────────────────────────── */

  /**
   * The stored preset the live sound is measured against.
   *
   * The amp reports which slot the live sound came from, so this is that slot's
   * stored copy — not whichever preset button is lit, which can differ once you
   * have stored to a different slot.
   */
  storedForLive(): Preset | null {
    const live = this.#snapshot.live
    if (!live) return null
    return live.channel <= 3 ? this.#snapshot.stored[live.channel] ?? null : null
  }

  /** Put one parameter back to what the stored preset holds. */
  revertParam(slot: number, index: number): void {
    const stored = this.storedForLive()?.pedals[slot]
    const live = this.#snapshot.live?.pedals[slot]
    if (!stored || !live || stored.name !== live.name) return
    const value = stored.params[index]
    if (value === undefined) return
    this.setParam(slot, index, value)
  }

  /** Put a whole slot back: its model, its bypass and every knob. */
  revertSlot(slot: number): void {
    const stored = this.storedForLive()?.pedals[slot]
    const live = this.#snapshot.live?.pedals[slot]
    if (!stored || !live) return

    if (stored.name !== live.name) {
      // Swapping brings a different set of parameters with it, so ask the amp
      // what they are rather than writing values into a model that may not have
      // them. The upload path would be wrong here too: it would revert the
      // whole chain, not this slot.
      this.swapModel(slot, stored.name)
      this.#log('event', `reverting ${spec(slot)} to ${stored.name}`)
      return
    }

    if (stored.on !== live.on) this.toggleSlot(slot)
    stored.params.forEach((value, index) => {
      if (Math.abs((live.params[index] ?? value) - value) > 5e-4) this.setParam(slot, index, value)
    })
  }

  /** Put the whole sound back to the stored preset. */
  revertAll(): void {
    const stored = this.storedForLive()
    if (!stored) return
    for (let slot = 0; slot < stored.pedals.length; slot++) this.revertSlot(slot)
    this.#log('event', `reverting to "${stored.name}"`)
  }

  /**
   * Rename the live sound.
   *
   * There is no command for a name on its own, so this uploads the whole preset
   * with the new name. That is also why the name only reaches the amp when you
   * commit the edit rather than on every keystroke.
   */
  renameLive(name: string): void {
    const live = this.#snapshot.live
    if (!live || live.name === name || name.trim() === '') return
    this.uploadPreset({ ...live, name })
  }

  /**
   * Send a whole preset — the path that makes a preset held in a file audible.
   *
   * It goes as the *live* sound: lead byte 01, carrying the channel of the slot
   * currently selected. That is the form this amp uses when it reports its own
   * live state, and it is deliberately not the `7f` community notes describe as
   * "temporary". A capture shows the amp acknowledging a `7f` upload and then
   * discarding it, so `7f` looks like a value it parses and will not accept.
   *
   * Nothing is stored. Committing a sound to a slot is {@link storeToSlot},
   * which is destructive and asks first.
   */
  uploadPreset(preset: Preset, options: { channel?: number; live?: boolean } = {}): void {
    const live = options.live ?? true
    const channel =
      options.channel ?? this.#snapshot.live?.channel ?? this.#snapshot.currentPreset ?? 0
    const target: Preset = { ...preset, channel, ...(live ? { live: true } : {}) }
    if (!live) delete target.live
    const problems = validatePreset(target)
    if (problems.length > 0) {
      this.#log('error', `will not send "${preset.name}": ${problems[0]}`)
      return
    }
    this.#uploadSeq = (this.#uploadSeq + 1) & 0x7f || 1
    this.#send(cmd.sendPreset(target, this.#uploadSeq), cmd.requestLiveState())
    this.#log('event', `sending preset "${target.name}" as ${live ? 'live' : 'stored'}, channel ${channel}`)
  }

  /* ── captures ───────────────────────────────────────────────────────────── */

  exportCapture(title: string): Capture | null {
    return this.#transport?.export(title) ?? null
  }

  clearCapture(): void {
    this.#transport?.clear()
    this.#patch({ recordedEvents: 0 })
  }

  clearLog(): void {
    this.#patch({ log: [] })
  }

  /* ── incoming ───────────────────────────────────────────────────────────── */

  #onData(bytes: Uint8Array): void {
    if (this.rawLogging) this.#log('rx', `${bytes.length} bytes`, hex(bytes))
    for (const message of this.#assembler.acceptAll(this.#stream.push(bytes))) {
      this.#apply(message)
    }
    this.#patch({ recordedEvents: this.#transport?.eventCount ?? 0 })
  }

  #onDisconnected(reason?: string): void {
    this.#patch({ status: 'disconnected', queueDepth: 0 })
    this.#log('error', reason ?? 'the link dropped')
  }

  #apply(message: AmpMessage): void {
    switch (message.type) {
      case 'preset': {
        const preset = message.preset
        if (!preset.live && preset.channel <= 3) {
          const stored = [...this.#snapshot.stored]
          stored[preset.channel] = preset
          this.#patch({ stored })
        }
        // The live sound is the one the interface edits. A stored preset only
        // becomes live when the amp says it has been selected.
        if (preset.live || preset.channel === LIVE_CHANNEL || this.#snapshot.live === null) {
          this.#patch({ live: preset, bpm: preset.bpm })
        }
        if (!message.checksumOk) {
          this.#log('event', `preset "${preset.name}" arrived with a checksum we did not expect`)
        }
        break
      }
      case 'presetNumber':
      case 'presetButton':
        this.#patch({ currentPreset: message.preset })
        if (message.type === 'presetButton') this.#send(cmd.requestLiveState())
        break
      case 'presetStored':
        // Ask for it back rather than assuming what landed there: the stored
        // copy is what future comparisons are measured against, so a guess here
        // would quietly poison every diff afterwards.
        this.#send(cmd.requestPreset(message.slot))
        break
      case 'effectToggled':
        this.#updatePedal(message.name, (pedal) => ({ ...pedal, on: message.on }))
        break
      case 'effectParam':
        this.#updatePedal(message.name, (pedal) => {
          const params = [...pedal.params]
          params[message.index] = message.value
          return { ...pedal, params }
        })
        break
      case 'effectSwapped':
        this.#updatePedal(message.from, (pedal) => ({ ...pedal, name: message.to }))
        break
      case 'bpm':
        this.#patch({ bpm: message.value })
        break
      case 'ampName':
        this.#patch({ deviceName: message.name })
        break
      case 'serialNumber':
        this.#patch({ serial: message.serial })
        break
      case 'ack':
        break
      case 'unknown':
        this.#log('event', describeMessage(message))
        return
    }

    if (message.type !== 'ack') this.#log('rx', describeMessage(message))
  }

  /* ── plumbing ───────────────────────────────────────────────────────────── */

  #send(...commands: cmd.Command[]): void {
    if (!this.#queue) return
    this.#queue.send(...commands)
    this.#patch({ queueDepth: this.#queue.depth })
  }

  #updateLive(change: (live: Preset) => Preset): void {
    const live = this.#snapshot.live
    if (live) this.#patch({ live: change(live) })
  }

  #updatePedal(name: string, change: (pedal: Preset['pedals'][number]) => Preset['pedals'][number]): void {
    this.#updateLive((live) => {
      const at = live.pedals.findIndex((p) => p.name === name)
      if (at < 0) return live
      const pedals = [...live.pedals]
      pedals[at] = change(pedals[at] as Preset['pedals'][number])
      return { ...live, pedals }
    })
  }

  #log(kind: LogEntry['kind'], text: string, raw?: string): void {
    const entry: LogEntry = { id: ++this.#logId, at: Date.now(), kind, text, ...(raw ? { raw } : {}) }
    const log = [...this.#snapshot.log, entry]
    this.#patch({ log: log.length > MAX_LOG ? log.slice(-MAX_LOG) : log })
  }

  #patch(change: Partial<AmpSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...change }
    for (const listener of this.#subscribers) listener()
  }
}

function spec(slot: number): string {
  return `slot ${slot + 1}`
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** A blank preset, for building one from nothing. */
export function emptyPreset(name = 'New Tone'): Preset {
  return {
    channel: LIVE_CHANNEL,
    uuid: newUuid(),
    name,
    version: '0.7',
    description: '',
    icon: 'icon.png',
    bpm: 120,
    pedals: [
      { name: 'bias.noisegate', on: true, params: [0.2, 0.3] },
      { name: 'LA2AComp', on: false, params: [0.5, 0.5] },
      { name: 'Booster', on: false, params: [0.5, 0.5, 0.5] },
      { name: 'Twin', on: true, params: [0.5, 0.5, 0.5, 0.5, 0.5] },
      { name: 'ChorusAnalog', on: false, params: [0.5, 0.5, 0.5, 0.5] },
      { name: 'DelayMono', on: false, params: [0.3, 0.4, 0.3, 0.5, 0.3] },
      { name: 'bias.reverb', on: true, params: [0.3, 0.5, 0.4, 0.5, 0.5, 0.5, 0.125] },
    ],
  }
}

export { AMP_SLOT, HARDWARE_PRESETS, SLOT_COUNT }
