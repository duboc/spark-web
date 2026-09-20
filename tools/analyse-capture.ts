/**
 * Read a capture recorded from a real amp and report what it says about the
 * protocol.
 *
 * This is the tool that turns a session into evidence. It answers the questions
 * in docs/open-questions.md from bytes rather than from argument:
 *
 *  - Does the amp validate the checksum byte, or can we read a real one?
 *  - Does a single-chunk reply carry the 3-byte [total, index, count] header?
 *  - Is that header inside or outside the 7-bit encoded region?
 *  - How many parameters does each effect actually have?
 *  - Does a real preset's checksum match the 0xCC rule?
 *
 * Run it:
 *   npx vite-node tools/analyse-capture.ts -- <path to capture.json>
 */

import { readFileSync } from 'node:fs'
import { ChunkStream, splitChunkData, xorChecksum, MAX_BLOCK_FROM_AMP } from '../src/protocol/frame.js'
import { MessageAssembler, decodeMessage, describe } from '../src/protocol/messages.js'
import { dec7, fromHex, hex, concat } from '../src/protocol/codec.js'
import { parsePresetDetailed } from '../src/protocol/preset.js'
import type { Capture } from '../src/transport/recorder.js'

const path = process.argv[2]
if (!path) {
  console.error('usage: vite-node tools/analyse-capture.ts -- <capture.json>')
  process.exit(1)
}

const capture = JSON.parse(readFileSync(path, 'utf8')) as Capture
const rx = capture.events.filter((e) => e.direction === 'rx').map((e) => fromHex(e.bytes))
const tx = capture.events.filter((e) => e.direction === 'tx').map((e) => fromHex(e.bytes))

console.log(`capture: ${capture.title}`)
console.log(`device:  ${capture.device}`)
console.log(`events:  ${tx.length} written, ${rx.length} received\n`)

/* ── block sizes ──────────────────────────────────────────────────────────── */

const blockSizes = new Set<number>()
for (const bytes of rx) {
  for (let i = 0; i + 6 < bytes.length; i++) {
    if (bytes[i] === 0x01 && bytes[i + 1] === 0xfe) blockSizes.add(bytes[i + 6] as number)
  }
}
const sizes = [...blockSizes].sort((a, b) => a - b)
console.log('── blocks from the amp ──')
console.log(`sizes seen: ${sizes.join(', ')}`)
console.log(`largest:    ${Math.max(...sizes)} (documented ceiling ${MAX_BLOCK_FROM_AMP})\n`)

/* ── chunks ───────────────────────────────────────────────────────────────── */

const stream = new ChunkStream()
const chunks = rx.flatMap((bytes) => stream.push(bytes))

let checksumMatches = 0
const headerOnSingle: { with: number; without: number } = { with: 0, without: 0 }
const seqBySub = new Map<string, Set<number>>()

console.log('── chunks ──')
console.log(`total: ${chunks.length}`)

for (const chunk of chunks) {
  if (xorChecksum(chunk.body) === chunk.checksum) checksumMatches++

  const key = `${chunk.cmd.toString(16).padStart(2, '0')} ${chunk.sub.toString(16).padStart(2, '0')}`
  if (!seqBySub.has(key)) seqBySub.set(key, new Set())
  seqBySub.get(key)?.add(chunk.seq)

  const split = splitChunkData(dec7(chunk.body))
  if (split.total <= 1) {
    if (split.hasHeader) headerOnSingle.with++
    else headerOnSingle.without++
  }
}

console.log(
  `checksum byte is the xor of the body: ${checksumMatches}/${chunks.length}` +
    (checksumMatches === chunks.length ? '  — the amp computes it' : '  — it does not, or we xor the wrong span'),
)
console.log(
  `single-chunk replies carrying a [total,index,count] header: ` +
    `${headerOnSingle.with} with, ${headerOnSingle.without} without`,
)
console.log('sequence bytes per command:')
for (const [key, seqs] of [...seqBySub].sort()) {
  console.log(`  ${key}  ${[...seqs].map((s) => s.toString(16).padStart(2, '0')).join(' ')}`)
}
console.log()

/* ── messages ─────────────────────────────────────────────────────────────── */

const assembler = new MessageAssembler()
const messages = assembler.acceptAll(chunks)

console.log('── messages ──')
const counts = new Map<string, number>()
for (const message of messages) counts.set(message.type, (counts.get(message.type) ?? 0) + 1)
for (const [type, n] of [...counts].sort()) console.log(`  ${type.padEnd(16)} ${n}`)

const unread = messages.filter((m) => m.type === 'unknown')
if (unread.length > 0) {
  console.log(`\n${unread.length} message(s) we could not read:`)
  for (const message of unread.slice(0, 10)) console.log(`  ${describe(message)}`)
}
console.log()

/* ── presets ──────────────────────────────────────────────────────────────── */

console.log('── presets ──')
const paramCounts = new Map<string, Set<number>>()

for (const message of messages) {
  if (message.type !== 'preset') continue
  const preset = message.preset
  console.log(
    `  channel ${preset.channel.toString(16).padStart(2, '0')}  "${preset.name}"  ` +
      `bpm ${preset.bpm.toFixed(1)}  checksum ${message.checksumOk ? "matches" : "DOES NOT match"}` +
      (preset.loudness === undefined ? '' : `  loudness ${preset.loudness.toFixed(3)}`) +
      (preset.extraGain === undefined ? '' : `  extraGain ${preset.extraGain.toFixed(3)}`),
  )
  for (const pedal of preset.pedals) {
    if (!paramCounts.has(pedal.name)) paramCounts.set(pedal.name, new Set())
    paramCounts.get(pedal.name)?.add(pedal.params.length)
  }
}

console.log('\n── parameter count per effect, measured ──')
for (const [name, seen] of [...paramCounts].sort()) {
  const counts = [...seen].sort((a, b) => a - b)
  console.log(`  ${name.padEnd(22)} ${counts.join(' or ')}${counts.length > 1 ? '   <- inconsistent' : ''}`)
}

/* ── the header question, tested directly ─────────────────────────────────── */

console.log('\n── where the multi-chunk header sits ──')
const multi = chunks.filter((c) => splitChunkData(dec7(c.body)).total > 1)
if (multi.length === 0) {
  console.log('  no multi-chunk message in this capture')
} else {
  const first = multi.find((c) => splitChunkData(dec7(c.body)).index === 0)
  if (first) {
    const decoded = dec7(first.body)
    const split = splitChunkData(decoded)
    console.log(`  raw body:      ${hex(first.body.subarray(0, 12))} …`)
    console.log(`  decoded:       ${hex(decoded.subarray(0, 12))} …`)
    console.log(`  header inside: total=${split.total} index=${split.index} count=${decoded[2]}`)
    console.log(`  bytes after the header: ${split.data.length}`)
    console.log(
      `  the data then begins ${hex(split.data.subarray(0, 4))}, and a preset begins with the\n` +
        `  lead byte, the channel, then a string tag — so the header is inside the encoded region`,
    )
  }
}

/* ── raw bytes of the first few replies, for eyeballing ───────────────────── */

console.log('\n── first three chunks, raw ──')
for (const chunk of chunks.slice(0, 3)) {
  console.log(
    `  cmd=${chunk.cmd.toString(16)} sub=${chunk.sub.toString(16)} seq=${chunk.seq.toString(16)} ` +
      `chk=${chunk.checksum.toString(16)}\n    body ${hex(chunk.body)}\n    dec7 ${hex(dec7(chunk.body))}`,
  )
}

void concat
void decodeMessage
