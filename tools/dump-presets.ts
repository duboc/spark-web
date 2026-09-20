/**
 * Print the presets in a capture, slot by slot, with every parameter named.
 *
 * Useful when you are building a preset by hand: it shows the exact shape the
 * amp produces, including how many parameters each effect really has on your
 * firmware, which is the part no documentation gets right.
 *
 * Run it:
 *   npx vite-node tools/dump-presets.ts -- <capture.json>
 */

import { readFileSync } from 'node:fs'
import { ChunkStream } from '../src/protocol/frame.js'
import { MessageAssembler } from '../src/protocol/messages.js'
import { fromHex } from '../src/protocol/codec.js'
import { knobLabel, displayName, SLOTS } from '../src/protocol/catalog.js'
import { reverbRoomFor } from '../src/protocol/knobs.js'
import type { Capture } from '../src/transport/recorder.js'

const path = process.argv[2]
if (!path) {
  console.error('usage: vite-node tools/dump-presets.ts -- <capture.json>')
  process.exit(1)
}

const capture = JSON.parse(readFileSync(path, 'utf8')) as Capture
const stream = new ChunkStream()
const assembler = new MessageAssembler()
const messages = capture.events
  .filter((event) => event.direction === 'rx')
  .flatMap((event) => assembler.acceptAll(stream.push(fromHex(event.bytes))))

const seen = new Set<string>()

for (const message of messages) {
  if (message.type !== 'preset') continue
  const preset = message.preset
  const key = `${preset.live ? 'live' : 'stored'}-${preset.channel}-${preset.name}`
  if (seen.has(key)) continue
  seen.add(key)

  console.log(
    `\n══ ${preset.live ? 'live state' : `preset ${preset.channel + 1}`}: "${preset.name}" ` +
      `· ${preset.bpm.toFixed(0)} bpm · version ${preset.version}`,
  )
  if (preset.loudness !== undefined) console.log(`   loudness ${preset.loudness.toFixed(3)}`)
  if (preset.extraGain !== undefined) console.log(`   extra gain ${preset.extraGain.toFixed(3)}`)

  preset.pedals.forEach((pedal, slot) => {
    const kind = SLOTS[slot]?.kind ?? `slot ${slot}`
    console.log(
      `   ${kind.padEnd(7)} ${pedal.on ? 'ON ' : 'off'} ${displayName(slot, pedal.name).padEnd(18)} ` +
        `${pedal.name} (${pedal.params.length} params)`,
    )
    pedal.params.forEach((value, index) => {
      const label = knobLabel(slot, pedal.name, index)
      const room =
        pedal.name === 'bias.reverb' && index === 6 ? `  → ${reverbRoomFor(value)?.name ?? '?'}` : ''
      console.log(
        `             ${String(index).padStart(2)} ${label.padEnd(14)} ` +
          `${value.toFixed(4)}  (${(value * 10).toFixed(1)})${room}`,
      )
    })
  })
}
