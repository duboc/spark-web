/**
 * Records every byte in and out, so a session can become a test fixture.
 *
 * This is the highest-value thing in the transport layer, and it is worth being
 * clear why. Everything above `protocol/` is currently tested against bytes this
 * project generated itself. That proves the encoder and the decoder agree with
 * each other; it proves nothing about whether either agrees with the amp. Only
 * bytes captured from hardware can do that.
 *
 * So: connect to a real Spark, turn a knob, press a preset button, swap a model,
 * then {@link RecordingTransport.export} the session and save it under
 * `test/fixtures/`. Those bytes answer the questions the documentation leaves
 * open — where the chunk header sits, whether the amp validates the sequence and
 * checksum bytes, what a real preset's checksum actually is.
 *
 * Wrapping a transport rather than living inside one means a recording of a
 * mock session and a recording of a real session have the same shape.
 */

import { hex } from '../protocol/codec.js'
import type { Transport, TransportInfo, TransportListener } from './types.js'
import { Listeners } from './types.js'

export interface RecordedEvent {
  /** Milliseconds since the recording started. */
  at: number
  direction: 'tx' | 'rx'
  /** Space-separated hex, so a capture file is readable and diffable. */
  bytes: string
  /** What the application thought it was doing, when it said. */
  label?: string
}

export interface Capture {
  /** What this session was, in your words. Set it before exporting. */
  title: string
  recordedAt: string
  device: string
  events: RecordedEvent[]
}

export class RecordingTransport implements Transport {
  readonly #inner: Transport
  readonly #listeners = new Listeners()
  #events: RecordedEvent[] = []
  #startedAt = 0
  #device = 'unknown'
  #nextLabel: string | undefined

  constructor(inner: Transport) {
    this.#inner = inner
    this.#inner.listen({
      data: (bytes) => {
        this.#record('rx', bytes)
        this.#listeners.data(bytes)
      },
      disconnected: (reason) => this.#listeners.disconnected(reason),
    })
  }

  get label(): string {
    return `${this.#inner.label} (recording)`
  }

  get connected(): boolean {
    return this.#inner.connected
  }

  get eventCount(): number {
    return this.#events.length
  }

  async connect(): Promise<TransportInfo> {
    this.#events = []
    this.#startedAt = Date.now()
    const info = await this.#inner.connect()
    this.#device = info.name
    return info
  }

  disconnect(): Promise<void> {
    return this.#inner.disconnect()
  }

  async write(block: Uint8Array): Promise<void> {
    this.#record('tx', block)
    await this.#inner.write(block)
  }

  listen(listener: TransportListener): () => void {
    return this.#listeners.add(listener)
  }

  /** Label the next write, so a capture says what each burst of bytes was for. */
  labelNext(label: string): void {
    this.#nextLabel = label
  }

  clear(): void {
    this.#events = []
    this.#startedAt = Date.now()
  }

  export(title: string): Capture {
    return {
      title,
      recordedAt: new Date(this.#startedAt || Date.now()).toISOString(),
      device: this.#device,
      events: this.#events,
    }
  }

  #record(direction: 'tx' | 'rx', bytes: Uint8Array): void {
    const label = direction === 'tx' ? this.#nextLabel : undefined
    if (direction === 'tx') this.#nextLabel = undefined
    this.#events.push({
      at: this.#startedAt ? Date.now() - this.#startedAt : 0,
      direction,
      bytes: hex(bytes),
      ...(label ? { label } : {}),
    })
  }
}

/**
 * Replays a capture: the bytes the amp sent, in the order and at the intervals
 * it sent them.
 *
 * Writes go nowhere. A replay cannot answer a question it was not recorded
 * asking, which is the point — it reproduces one session exactly, and a
 * reassembler that copes with a real session's block boundaries is a
 * reassembler that has met the real thing.
 */
export class ReplayTransport implements Transport {
  readonly label = 'Replay'
  readonly #capture: Capture
  readonly #listeners = new Listeners()
  readonly #timers: ReturnType<typeof setTimeout>[] = []
  readonly #speed: number
  #connected = false

  constructor(capture: Capture, options: { speed?: number } = {}) {
    this.#capture = capture
    this.#speed = options.speed ?? 1
  }

  get connected(): boolean {
    return this.#connected
  }

  async connect(): Promise<TransportInfo> {
    this.#connected = true
    for (const event of this.#capture.events) {
      if (event.direction !== 'rx') continue
      const bytes = parseHex(event.bytes)
      const at = this.#speed > 0 ? event.at / this.#speed : 0
      this.#timers.push(setTimeout(() => this.#connected && this.#listeners.data(bytes), at))
    }
    return { name: this.#capture.device }
  }

  async disconnect(): Promise<void> {
    this.#connected = false
    for (const timer of this.#timers) clearTimeout(timer)
    this.#timers.length = 0
    this.#listeners.disconnected('replay ended')
  }

  async write(): Promise<void> {
    // A replay has already decided what it is going to say.
  }

  listen(listener: TransportListener): () => void {
    return this.#listeners.add(listener)
  }
}

function parseHex(text: string): Uint8Array {
  const cleaned = text.replace(/[^0-9a-fA-F]/g, '')
  const out = new Uint8Array(cleaned.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16)
  return out
}
