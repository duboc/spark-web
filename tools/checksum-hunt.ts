/**
 * Work out the rule behind a preset's trailing checksum byte.
 *
 * The community notes say: sum every byte after the channel, modulo 256, adding
 * 0xCC in place of any byte above 127. Against presets captured from a real
 * Spark 40 that rule produces the wrong answer, so this tries a family of
 * candidates and reports which one, if any, reproduces every stored byte.
 *
 * Run it:
 *   npx vite-node tools/checksum-hunt.ts -- <capture.json>
 */

import { readFileSync } from 'node:fs'
import { ChunkStream, splitChunkData } from '../src/protocol/frame.js'
import { concat, dec7, fromHex, hex } from '../src/protocol/codec.js'
import type { Capture } from '../src/transport/recorder.js'

const path = process.argv[2]
if (!path) {
  console.error('usage: vite-node tools/checksum-hunt.ts -- <capture.json>')
  process.exit(1)
}

const capture = JSON.parse(readFileSync(path, 'utf8')) as Capture
const stream = new ChunkStream()
const chunks = capture.events
  .filter((e) => e.direction === 'rx')
  .flatMap((e) => stream.push(fromHex(e.bytes)))

const payloads: Uint8Array[] = []
let parts: (Uint8Array | undefined)[] = []
let total = 0

for (const chunk of chunks) {
  if (chunk.cmd !== 0x03 || chunk.sub !== 0x01) continue
  const split = splitChunkData(dec7(chunk.body))
  if (split.total <= 1) continue
  if (split.index === 0) {
    parts = new Array(split.total).fill(undefined)
    total = split.total
  }
  if (total === 0) continue
  parts[split.index] = split.data
  if (parts.filter(Boolean).length === total) {
    payloads.push(concat(parts as Uint8Array[]))
    parts = []
    total = 0
  }
}

const unique = [...new Map(payloads.map((p) => [hex(p), p])).values()]
console.log(`${payloads.length} preset payloads, ${unique.length} distinct\n`)
for (const p of unique) {
  console.log(
    `  len ${String(p.length).padStart(4)}  lead ${p[0]}  channel ${p[1]}  ` +
      `stored checksum 0x${(p[p.length - 1] as number).toString(16).padStart(2, '0')}`,
  )
}

type Accumulate = (running: number, byte: number) => number

const accumulators: Record<string, Accumulate> = {
  'sum, 0xCC above 127': (s, b) => s + (b > 127 ? 0xcc : b),
  'plain sum': (s, b) => s + b,
  'sum of low 7 bits': (s, b) => s + (b & 0x7f),
  xor: (s, b) => s ^ b,
  'sum, skipping above 127': (s, b) => s + (b > 127 ? 0 : b),
}

console.log('\n── candidates ──')
const winners: string[] = []

for (const [name, accumulate] of Object.entries(accumulators)) {
  for (const from of [0, 1, 2, 3]) {
    for (const negate of [false, true]) {
      const label = `${name}, from byte ${from}${negate ? ', negated' : ''}`
      const compute = (bytes: Uint8Array): number => {
        let running = 0
        for (let i = from; i < bytes.length - 1; i++) running = accumulate(running, bytes[i] as number)
        const value = running & 0xff
        return negate ? (0x100 - value) & 0xff : value
      }
      const results = unique.map((p) => [compute(p), p[p.length - 1] as number] as const)
      if (results.every(([got, want]) => got === want)) {
        winners.push(label)
        console.log(`  MATCHES EVERY PRESET  ${label}`)
      }
    }
  }
}

if (winners.length === 0) {
  console.log('  nothing matched. closest attempts, for reading:')
  for (const [name, accumulate] of Object.entries(accumulators)) {
    for (const from of [1, 2]) {
      let running = 0
      const first = unique[0] as Uint8Array
      for (let i = from; i < first.length - 1; i++) running = accumulate(running, first[i] as number)
      console.log(
        `  ${`${name}, from ${from}`.padEnd(32)} got 0x${(running & 0xff).toString(16).padStart(2, '0')}` +
          `  want 0x${(first[first.length - 1] as number).toString(16).padStart(2, '0')}`,
      )
    }
  }
  console.log(
    '\n  If nothing fits, the last byte may not be a checksum at all — check whether\n' +
      '  it is simply the last value in the preset rather than a trailer.',
  )
  const first = unique[0] as Uint8Array
  console.log(`\n  last 12 bytes of the first preset: ${hex(first.subarray(-12))}`)
}
