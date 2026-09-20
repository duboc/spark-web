/**
 * Write the presets in a capture out as preset files.
 *
 * A capture holds whatever the amp was carrying when it was recorded, so this
 * turns a session into a backup you can read, keep in a repository and send
 * back. Recovering a slot you overwrote is then a matter of loading a file.
 *
 * Run it:
 *   npx vite-node tools/export-presets.ts -- <capture.json> <output directory>
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { ChunkStream } from '../src/protocol/frame.js'
import { MessageAssembler } from '../src/protocol/messages.js'
import { fromHex } from '../src/protocol/codec.js'
import type { Preset } from '../src/protocol/preset.js'
import type { Capture } from '../src/transport/recorder.js'

const [, , capturePath, outDir] = process.argv
if (!capturePath || !outDir) {
  console.error('usage: vite-node tools/export-presets.ts -- <capture.json> <directory>')
  process.exit(1)
}

const capture = JSON.parse(readFileSync(capturePath, 'utf8')) as Capture
const stream = new ChunkStream()
const assembler = new MessageAssembler()

const found = new Map<number, Preset>()
for (const event of capture.events) {
  if (event.direction !== 'rx') continue
  for (const message of assembler.acceptAll(stream.push(fromHex(event.bytes)))) {
    // Only stored presets. The live state is a copy of one of them and would
    // overwrite the real thing with whatever was being edited at the time.
    if (message.type === 'preset' && !message.preset.live && message.preset.channel <= 3) {
      found.set(message.preset.channel, message.preset)
    }
  }
}

mkdirSync(outDir, { recursive: true })

for (const [channel, preset] of [...found].sort((a, b) => a[0] - b[0])) {
  const name = `slot-${channel + 1}-${slug(preset.name)}.spark.json`
  writeFileSync(join(outDir, name), `${JSON.stringify(preset, null, 2)}\n`, 'utf8')
  console.log(`  ${name}  ("${preset.name}", ${preset.pedals.length} slots)`)
}

console.log(`\n${found.size} preset(s) written to ${outDir}`)

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
