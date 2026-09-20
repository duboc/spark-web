/**
 * A Spark that only exists in memory.
 *
 * This answers commands the way the amp does: it holds four stored presets and a
 * live sound, applies changes, and replies with the same messages over the same
 * framing. It exists for three reasons, in order of how much they matter.
 *
 * First, the receive path can be tested end to end with no hardware. Second, the
 * interface can be worked on at a desk with no amp in the room. Third, and least
 * obviously, it frames its replies the way the amp does — blocks capped at
 * 0x6a, which is *smaller* than one chunk. So chunks straddle block boundaries
 * here exactly as they do on real hardware, and a reassembler that cannot cope
 * fails against the mock rather than surviving until the amp is switched on.
 *
 * What it does not do is prove anything about the real protocol. It replies the
 * way we believe the amp replies; if that belief is wrong, the mock is wrong in
 * precisely the same way and agrees with us enthusiastically. Only bytes
 * captured from hardware settle that.
 */

import { ChunkStream, encodeBlocksFromAmp, splitChunkData, type RawChunk } from '../protocol/frame.js'
import { Reader, dec7, concat } from '../protocol/codec.js'
import { parsePreset, serializePreset, newUuid, type Preset } from '../protocol/preset.js'
import { Listeners, type Transport, type TransportInfo, type TransportListener } from './types.js'

/**
 * Four presets to answer with.
 *
 * The parameter counts are the ones a real Spark 40 reports, measured from the
 * capture in `test/fixtures/`: one on `Booster`, two on `Compressor`, `Phaser`
 * and `Cloner`, three on the noise gate and `DistortionTS9`, four on
 * `ChorusAnalog`, five on `DelayMono` and every amp, eight on `bias.reverb`.
 *
 * Getting these right matters more than it looks. A mock with invented counts
 * lets the interface be built against knobs that do not exist, and the mistake
 * only surfaces when an amp is plugged in.
 */
const FACTORY: Array<Pick<Preset, 'name' | 'pedals'>> = [
  {
    name: 'Clean Start',
    pedals: [
      { name: 'bias.noisegate', on: true, params: [0.15, 0.3, 0] },
      { name: 'LA2AComp', on: false, params: [0, 0.4, 0.5] },
      { name: 'Booster', on: false, params: [0.3] },
      { name: 'RolandJC120', on: true, params: [0.35, 0.6, 0.5, 0.55, 0.6] },
      { name: 'ChorusAnalog', on: true, params: [0.35, 0.4, 0.5, 0.5] },
      { name: 'DelayMono', on: false, params: [0.2, 0.3, 0.25, 0.5, 0.3] },
      { name: 'bias.reverb', on: true, params: [0.3, 0.5, 0.4, 0.5, 0.5, 0.5, 0.1, 1] },
    ],
  },
  {
    name: 'Crunch',
    pedals: [
      { name: 'bias.noisegate', on: true, params: [0.25, 0.35, 0] },
      { name: 'Compressor', on: true, params: [0.5, 0.45] },
      { name: 'DistortionTS9', on: true, params: [0.45, 0.55, 0.5] },
      { name: 'Plexi', on: true, params: [0.6, 0.55, 0.5, 0.45, 0.6] },
      { name: 'Tremolo', on: false, params: [0.4, 0.5, 0.5] },
      { name: 'VintageDelay', on: true, params: [0.3, 0.35, 0.3, 0.5] },
      { name: 'bias.reverb', on: true, params: [0.25, 0.5, 0.35, 0.5, 0.5, 0.5, 0.3, 1] },
    ],
  },
  {
    name: 'Lead',
    pedals: [
      { name: 'bias.noisegate', on: true, params: [0.35, 0.4, 0] },
      { name: 'BlueComp', on: true, params: [0.55, 0.5, 0.4, 0.6] },
      { name: 'ProCoRat', on: true, params: [0.6, 0.5, 0.55] },
      { name: 'SLO100', on: true, params: [0.75, 0.6, 0.45, 0.5, 0.55] },
      { name: 'Phaser', on: false, params: [0.5, 0.5] },
      { name: 'DelayEchoFilt', on: true, params: [0.4, 0.45, 0.35, 0.5, 0.45] },
      { name: 'bias.reverb', on: true, params: [0.4, 0.5, 0.45, 0.5, 0.5, 0.5, 0.6, 1] },
    ],
  },
  {
    name: 'Acoustic',
    pedals: [
      { name: 'bias.noisegate', on: false, params: [0.1, 0.3, 0] },
      { name: 'BBEOpticalComp', on: true, params: [0.45, 0.5, 0.5, 0] },
      { name: 'Booster', on: false, params: [0.2] },
      { name: 'Acoustic', on: true, params: [0.3, 0.55, 0.5, 0.6, 0.65] },
      { name: 'Cloner', on: false, params: [0.3, 0.5] },
      { name: 'DelayMono', on: false, params: [0.2, 0.3, 0.2, 0.5, 0.3] },
      { name: 'bias.reverb', on: true, params: [0.45, 0.5, 0.5, 0.5, 0.5, 0.5, 0.8, 1] },
    ],
  },
]

function factoryPreset(channel: number): Preset {
  const source = FACTORY[channel] as (typeof FACTORY)[number]
  return {
    channel,
    uuid: newUuid(),
    name: source.name,
    version: '0.7',
    description: 'factory preset',
    icon: 'icon.png',
    bpm: 120,
    pedals: source.pedals.map((p) => ({ ...p, params: [...p.params] })),
  }
}

export interface MockOptions {
  /** Milliseconds before a reply comes back, so the interface meets some latency. */
  latencyMs?: number
}

export class MockTransport implements Transport {
  readonly label = 'Mock amp'

  #connected = false
  #presets: Preset[] = []
  #live: Preset = factoryPreset(0)
  #current = 0
  #seq = 0x40

  readonly #stream = new ChunkStream()
  readonly #uploads = new Map<number, { parts: (Uint8Array | undefined)[]; received: number; total: number }>()
  readonly #listeners = new Listeners()
  readonly #latency: number

  constructor(options: MockOptions = {}) {
    this.#latency = options.latencyMs ?? 20
    this.#reset()
  }

  get connected(): boolean {
    return this.#connected
  }

  /** The live sound, for tests that want to check what a command did. */
  get liveState(): Preset {
    return this.#live
  }

  get storedPresets(): readonly Preset[] {
    return this.#presets
  }

  async connect(): Promise<TransportInfo> {
    this.#reset()
    this.#connected = true
    this.#stream.reset()
    return { name: 'Spark 40 BLE (mock)' }
  }

  async disconnect(): Promise<void> {
    this.#connected = false
    this.#listeners.disconnected('mock disconnected')
  }

  listen(listener: TransportListener): () => void {
    return this.#listeners.add(listener)
  }

  async write(block: Uint8Array): Promise<void> {
    if (!this.#connected) throw new Error('not connected')
    for (const chunk of this.#stream.push(block)) this.#handle(chunk)
  }

  /** Pretend somebody turned a knob on the amp itself. */
  turnKnob(name: string, index: number, value: number): void {
    const pedal = this.#live.pedals.find((p) => p.name === name)
    if (pedal) pedal.params[index] = value
    this.#reply(0x03, 0x37, concat([pstrBytes(name), Uint8Array.of(index), f32Bytes(value)]))
  }

  /** Pretend somebody pressed a preset button on the amp itself. */
  pressPreset(slot: number): void {
    this.#selectPreset(slot)
    this.#reply(0x03, 0x38, Uint8Array.of(0x00, slot))
  }

  #reset(): void {
    this.#presets = [0, 1, 2, 3].map(factoryPreset)
    // The live sound is marked by its lead byte and keeps the channel of the
    // slot it came from, which is what a real Spark 40 reports. It is not
    // channel 0x7f, whatever the community notes say.
    this.#live = { ...factoryPreset(0), live: true, channel: 0 }
    this.#current = 0
    this.#uploads.clear()
  }

  #handle(chunk: RawChunk): void {
    const split = splitChunkData(dec7(chunk.body))
    const data = split.data

    if (chunk.cmd === 0x01 && chunk.sub === 0x01) {
      this.#collectUpload(chunk, split.total, split.index, data)
      return
    }

    try {
      this.#dispatch(chunk.cmd, chunk.sub, data)
    } catch {
      // A real amp answers nonsense with silence, which is its own kind of
      // debugging hint, so the mock does the same.
    }
  }

  #collectUpload(chunk: RawChunk, total: number, index: number, part: Uint8Array): void {
    let entry = this.#uploads.get(chunk.seq)
    if (!entry || index === 0) {
      entry = { parts: new Array(total).fill(undefined), received: 0, total }
      this.#uploads.set(chunk.seq, entry)
    }
    if (index >= entry.total) return
    if (entry.parts[index] === undefined) entry.received++
    entry.parts[index] = part
    if (entry.received < entry.total) return

    this.#uploads.delete(chunk.seq)
    const preset = parsePreset(concat(entry.parts as Uint8Array[]))
    // A preset marked live changes the live sound and stores nothing. One that
    // is not marked live is taken as a write to its slot. This encodes what we
    // believe after watching the amp discard an upload on channel 7f; it is a
    // belief, and only hardware settles it.
    if (!preset.live && preset.channel <= 3) this.#presets[preset.channel] = preset
    this.#live = { ...preset, live: true, channel: preset.channel <= 3 ? preset.channel : this.#current }
    this.#reply(0x04, 0x01, new Uint8Array(0))
  }

  #dispatch(cmd: number, sub: number, data: Uint8Array): void {
    const r = new Reader(data)

    if (cmd === 0x02 && sub === 0x01) {
      const which = r.u8()
      if (which === 0x01) this.#sendPreset(this.#live)
      else this.#sendPreset(this.#presets[r.u8()] ?? this.#presets[0]!)
      return
    }
    if (cmd === 0x02 && sub === 0x10) {
      this.#reply(0x03, 0x10, Uint8Array.of(0x00, this.#current))
      return
    }
    if (cmd === 0x02 && sub === 0x11) {
      this.#reply(0x03, 0x11, pstrBytes('Spark 40 BLE'))
      return
    }
    if (cmd === 0x02 && sub === 0x23) {
      this.#reply(0x03, 0x23, pstrBytes('MOCK-00000001'))
      return
    }
    if (cmd === 0x01 && sub === 0x38) {
      r.u8()
      this.#selectPreset(r.u8())
      this.#reply(0x04, 0x38, new Uint8Array(0))
      return
    }
    if (cmd === 0x03 && sub === 0x27) {
      r.u8()
      const slot = r.u8()
      if (slot <= 3) {
        const stored = structuredCloneish(this.#live)
        delete stored.live
        this.#presets[slot] = { ...stored, channel: slot }
      }
      this.#reply(0x03, 0x27, Uint8Array.of(0x00, slot))
      return
    }
    if (cmd === 0x01 && sub === 0x15) {
      const name = r.pstr()
      const on = r.bool()
      const pedal = this.#live.pedals.find((p) => p.name === name)
      if (pedal) pedal.on = on
      this.#reply(0x04, 0x15, new Uint8Array(0))
      return
    }
    if ((cmd === 0x01 && sub === 0x04) || (cmd === 0x03 && sub === 0x37)) {
      const name = r.pstr()
      const index = r.u8()
      const value = r.f32()
      const pedal = this.#live.pedals.find((p) => p.name === name)
      if (pedal) pedal.params[index] = value
      // Parameter changes are not acknowledged. Anything waiting on a reply here
      // would wait for ever, which is worth reproducing rather than smoothing over.
      return
    }
    if ((cmd === 0x01 || cmd === 0x03) && sub === 0x06) {
      const from = r.pstr()
      const to = r.pstr()
      const pedal = this.#live.pedals.find((p) => p.name === from)
      if (pedal) {
        pedal.name = to
        pedal.params = pedal.params.map(() => 0.5)
      }
      this.#reply(0x03, 0x06, concat([pstrBytes(from), pstrBytes(to)]))
    }
  }

  #selectPreset(slot: number): void {
    if (slot > 3) return
    this.#current = slot
    this.#live = { ...structuredCloneish(this.#presets[slot] as Preset), live: true, channel: slot }
  }

  #sendPreset(preset: Preset): void {
    this.#reply(0x03, 0x01, serializePreset(preset), this.#nextSeq())
  }

  #nextSeq(): number {
    this.#seq = (this.#seq + 1) & 0x7f
    return this.#seq || 1
  }

  #reply(cmd: number, sub: number, payload: Uint8Array, seq?: number): void {
    const blocks = encodeBlocksFromAmp(cmd, sub, payload, seq === undefined ? {} : { seq })
    const deliver = (): void => {
      if (!this.#connected) return
      for (const block of blocks) this.#listeners.data(block)
    }
    if (this.#latency > 0) setTimeout(deliver, this.#latency)
    else deliver()
  }
}

function structuredCloneish(preset: Preset): Preset {
  return { ...preset, pedals: preset.pedals.map((p) => ({ ...p, params: [...p.params] })) }
}

function pstrBytes(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value)
  return Uint8Array.from([bytes.length, 0xa0 + bytes.length, ...bytes])
}

function f32Bytes(value: number): Uint8Array {
  const buf = new ArrayBuffer(4)
  new DataView(buf).setFloat32(0, value, false)
  return Uint8Array.from([0xca, ...new Uint8Array(buf)])
}
