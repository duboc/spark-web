/**
 * Block and chunk framing.
 *
 * A message travels as one or more *chunks*; each chunk travels inside one or
 * more *blocks*. Both layers have their own header, and the sizes interlock in a
 * way that is worth spelling out, because it settles a question the community
 * docs leave open.
 *
 * ## Block
 * ```
 *   0-1   01 fe        start marker
 *   2-3   00 00        reserved
 *   4-5   53 fe        app → amp          (41 ff for amp → app)
 *   6     size         whole block, including these 16 bytes
 *   7-15  00 × 9       padding
 * ```
 *
 * ## Chunk
 * ```
 *   0-1   f0 01        start marker
 *   2     seq          groups the chunks of one message
 *   3     checksum     XOR over the data bytes
 *   4     cmd
 *   5     sub
 *   ...   data         7-bit encoded, optionally preceded by 3 raw bytes
 *   last  f7           terminator
 * ```
 *
 * ## Where the multi-chunk header lives — still open
 *
 * Multi-chunk messages prefix each chunk's data with `[total, index, count]`.
 * Sources disagree on whether those three bytes sit inside or outside the 7-bit
 * encoded region, and it is tempting to think the stated size limits settle it.
 * They do not. Both readings land on exactly the documented ceiling:
 *
 * ```
 *   outside:  16 + 6 + 3 + enc7Length(128)     + 1 = 16 + 6 + 3 + 147 + 1 = 173
 *   inside:   16 + 6     + enc7Length(128 + 3) + 1 = 16 + 6     + 150 + 1 = 173
 * ```
 *
 * The coincidence is real: 128 and 131 raw bytes both encode into nineteen
 * groups, so the three header bytes cost three either way. A maximum chunk is
 * 128 data bytes and fills a maximum block exactly under both hypotheses. The
 * arithmetic constrains the chunk size and nothing else.
 *
 * So the two directions are handled differently, and deliberately:
 *
 *  - **Sending** follows the prior-art convention — header raw, outside the
 *    encoded region — because that is what the working clients this protocol was
 *    reconstructed from do, and the amp accepts their uploads.
 *  - **Receiving** detects it from the bytes. See {@link splitChunkData}.
 *
 * Whether single-chunk messages from the amp carry the header at all is equally
 * unsettled. Both questions want one capture from real hardware, after which the
 * detection can be replaced by a constant. Until then, nothing here should be
 * mistaken for a proof.
 */

import { ProtocolError, concat, dec7Length, enc7, enc7Length } from './codec.js'

export const BLOCK_HEADER_SIZE = 16
export const CHUNK_HEADER_SIZE = 6
export const MULTI_HEADER_SIZE = 3

/** Largest block the amp will accept. */
export const MAX_BLOCK_TO_AMP = 0xad
/** Largest block the amp emits. */
export const MAX_BLOCK_FROM_AMP = 0x6a

/** Largest data payload in one chunk, before 7-bit encoding. */
export const MAX_CHUNK_DATA = 128

export const BLOCK_START = [0x01, 0xfe] as const
export const DIR_TO_AMP = [0x53, 0xfe] as const
export const DIR_FROM_AMP = [0x41, 0xff] as const
export const CHUNK_START = [0xf0, 0x01] as const
export const CHUNK_END = 0xf7

/**
 * Sequence and checksum bytes used for single-chunk commands.
 *
 * `3a 15` is a fixed literal that working clients have sent for years, so it is
 * known to be accepted. The amp is reported not to validate either byte. We keep
 * the known-good literal for single-chunk commands rather than computing
 * something that is probably equivalent, and compute properly for multi-chunk
 * messages, where the sequence genuinely has to group the chunks together.
 */
export const FIXED_SEQ = 0x3a
export const FIXED_CHECKSUM = 0x15

/** XOR of every byte — the checksum the chunk header carries. */
export function xorChecksum(bytes: Uint8Array | readonly number[]): number {
  let x = 0
  for (const b of bytes) x ^= b & 0xff
  return x
}

export interface EncodeOptions {
  /** Sequence byte for multi-chunk messages. Ignored when the message fits one chunk. */
  seq?: number
}

/** Split a payload into the chunks that carry it, each already framed. */
export function buildChunks(
  cmd: number,
  sub: number,
  payload: Uint8Array | readonly number[],
  seq: number = FIXED_SEQ,
): Uint8Array[] {
  const data = payload instanceof Uint8Array ? payload : Uint8Array.from(payload)

  if (data.length <= MAX_CHUNK_DATA) {
    return [buildChunk(cmd, sub, FIXED_SEQ, enc7(data), null)]
  }

  const total = Math.ceil(data.length / MAX_CHUNK_DATA)
  if (total > 0x7f) {
    throw new RangeError(`payload of ${data.length} bytes needs ${total} chunks, more than 127`)
  }

  return Array.from({ length: total }, (_, index) => {
    const slice = data.subarray(index * MAX_CHUNK_DATA, (index + 1) * MAX_CHUNK_DATA)
    return buildChunk(cmd, sub, seq & 0x7f, enc7(slice), [total, index, slice.length])
  })
}

/**
 * Frame a message the way the amp does: blocks capped at
 * {@link MAX_BLOCK_FROM_AMP}, which is smaller than a full chunk, so chunks
 * spill across block boundaries.
 *
 * Only the mock transport and the tests send in this direction. It exists
 * because "a chunk can straddle a block boundary" is the single most awkward
 * property of the receive path, and a mock that never produces one would let
 * that bug through.
 */
export function encodeBlocksFromAmp(
  cmd: number,
  sub: number,
  payload: Uint8Array | readonly number[],
  options: EncodeOptions = {},
): Uint8Array[] {
  const stream = concat(buildChunks(cmd, sub, payload, options.seq ?? FIXED_SEQ))
  const capacity = MAX_BLOCK_FROM_AMP - BLOCK_HEADER_SIZE
  const blocks: Uint8Array[] = []

  for (let at = 0; at < stream.length; at += capacity) {
    const slice = stream.subarray(at, at + capacity)
    const block = new Uint8Array(BLOCK_HEADER_SIZE + slice.length)
    block.set(BLOCK_START, 0)
    block.set(DIR_FROM_AMP, 4)
    block[6] = block.length
    block.set(slice, BLOCK_HEADER_SIZE)
    blocks.push(block)
  }

  return blocks
}

/**
 * Frame a command into one or more blocks, ready to write to the amp.
 *
 * Payloads of up to {@link MAX_CHUNK_DATA} bytes produce a single chunk with no
 * `[total, index, count]` header — the form long-established clients send.
 * Anything larger is split, and every chunk then carries the header.
 */
export function encodeBlocks(
  cmd: number,
  sub: number,
  payload: Uint8Array | readonly number[],
  options: EncodeOptions = {},
): Uint8Array[] {
  // One chunk per block. A maximum chunk fills a maximum block exactly, so
  // nothing sent to the amp ever needs to straddle a block boundary.
  return buildChunks(cmd, sub, payload, options.seq ?? FIXED_SEQ).map(wrapBlock)
}

function buildChunk(
  cmd: number,
  sub: number,
  seq: number,
  encoded: Uint8Array,
  multiHeader: readonly [number, number, number] | null,
): Uint8Array {
  const body = multiHeader ? concat([Uint8Array.from(multiHeader), encoded]) : encoded
  const chunk = new Uint8Array(CHUNK_HEADER_SIZE + body.length + 1)
  chunk.set(CHUNK_START, 0)
  chunk[2] = seq
  chunk[3] = xorChecksum(body)
  chunk[4] = cmd
  chunk[5] = sub
  chunk.set(body, CHUNK_HEADER_SIZE)
  chunk[chunk.length - 1] = CHUNK_END
  // Single-chunk commands keep the literal every working client has sent.
  if (!multiHeader) chunk[3] = FIXED_CHECKSUM
  return chunk
}

function wrapBlock(chunk: Uint8Array): Uint8Array {
  const size = BLOCK_HEADER_SIZE + chunk.length
  if (size > MAX_BLOCK_TO_AMP) {
    throw new ProtocolError(
      `block of ${size} bytes exceeds the ${MAX_BLOCK_TO_AMP} byte ceiling`,
      0,
    )
  }
  const block = new Uint8Array(size)
  block.set(BLOCK_START, 0)
  block.set(DIR_TO_AMP, 4)
  block[6] = size
  block.set(chunk, BLOCK_HEADER_SIZE)
  return block
}

/** A framed chunk, pulled off the incoming byte stream and not yet decoded. */
export interface RawChunk {
  seq: number
  checksum: number
  cmd: number
  sub: number
  /** Everything between the chunk header and the `f7`, still 7-bit encoded. */
  body: Uint8Array
}

/** A chunk's body, split into its optional multi-chunk header and its encoded data. */
export interface ChunkData {
  /** Chunk count for this message, or 1 when there is no header. */
  total: number
  /** This chunk's position, or 0 when there is no header. */
  index: number
  /** Whether a `[total, index, count]` header was actually present. */
  hasHeader: boolean
  /** The still-encoded data, header removed. */
  encoded: Uint8Array
}

/**
 * Separate a chunk body's optional `[total, index, count]` header from its data.
 *
 * The header's presence on single-chunk messages from the amp is the one part of
 * the layout the size arithmetic cannot settle, so it is detected rather than
 * assumed — but detected by checking facts, not by decoding twice and keeping
 * whichever attempt did not throw.
 *
 * A header is recognised only when all three bytes agree with each other and
 * with the length of what follows:
 *
 *  - `total` is at least 1 and no more than 127
 *  - `index` is below `total`
 *  - `count` matches the data that follows, measured either raw or encoded
 *    (sources differ on which one it counts, and both readings are accepted)
 *
 * A plain encoded payload begins with a 7-bit mask byte and its own data, which
 * satisfies all three conditions only by coincidence.
 */
export function splitChunkData(body: Uint8Array): ChunkData {
  if (body.length > MULTI_HEADER_SIZE) {
    const total = body[0] as number
    const index = body[1] as number
    const count = body[2] as number
    const encodedLen = body.length - MULTI_HEADER_SIZE

    const plausible =
      total >= 1 &&
      total <= 0x7f &&
      index < total &&
      (count === encodedLen || count === dec7Length(encodedLen))

    if (plausible) {
      return { total, index, hasHeader: true, encoded: body.subarray(MULTI_HEADER_SIZE) }
    }
  }

  return { total: 1, index: 0, hasHeader: false, encoded: body }
}

/**
 * Pulls complete chunks out of a stream of BLE notifications.
 *
 * A notification is not a message and is not even a block: blocks arrive split
 * across notifications, and chunks run across block boundaries. So both layers
 * are buffered. Feed everything that arrives to {@link push} and take whatever
 * complete chunks come back.
 */
export class ChunkStream {
  #blocks: number[] = []
  #chunks: number[] = []

  /** Largest buffer we will hold before deciding the stream is garbage and dropping it. */
  readonly #limit: number

  constructor(limit = 8192) {
    this.#limit = limit
  }

  reset(): void {
    this.#blocks = []
    this.#chunks = []
  }

  push(data: Uint8Array): RawChunk[] {
    for (const b of data) this.#blocks.push(b)
    this.#drainBlocks()
    return this.#drainChunks()
  }

  /** Strip block headers, appending each block's contents to the chunk buffer. */
  #drainBlocks(): void {
    for (;;) {
      const start = findPair(this.#blocks, BLOCK_START[0], BLOCK_START[1])
      if (start < 0) {
        // Nothing framed in here. Keep only a trailing byte that might begin a marker.
        this.#blocks = this.#blocks.length > 0 ? this.#blocks.slice(-1) : []
        return
      }
      if (start > 0) this.#blocks.splice(0, start)
      if (this.#blocks.length < BLOCK_HEADER_SIZE) return

      const size = this.#blocks[6] as number
      if (size <= BLOCK_HEADER_SIZE || size > MAX_BLOCK_TO_AMP) {
        // Not a real block header after all — step past the false marker.
        this.#blocks.splice(0, 2)
        continue
      }
      if (this.#blocks.length < size) return

      const block = this.#blocks.splice(0, size)
      for (let i = BLOCK_HEADER_SIZE; i < block.length; i++) this.#chunks.push(block[i] as number)
      if (this.#chunks.length > this.#limit) this.#chunks = []
    }
  }

  /** Scan the de-blocked stream for `f0 01 … f7`. */
  #drainChunks(): RawChunk[] {
    const found: RawChunk[] = []

    for (;;) {
      const start = findPair(this.#chunks, CHUNK_START[0], CHUNK_START[1])
      if (start < 0) {
        this.#chunks = this.#chunks.length > 0 ? this.#chunks.slice(-1) : []
        return found
      }
      if (start > 0) this.#chunks.splice(0, start)
      if (this.#chunks.length < CHUNK_HEADER_SIZE + 1) return found

      const end = this.#chunks.indexOf(CHUNK_END, CHUNK_HEADER_SIZE)
      if (end < 0) {
        if (this.#chunks.length > this.#limit) this.#chunks = []
        return found
      }

      const raw = this.#chunks.splice(0, end + 1)
      found.push({
        seq: raw[2] as number,
        checksum: raw[3] as number,
        cmd: raw[4] as number,
        sub: raw[5] as number,
        body: Uint8Array.from(raw.slice(CHUNK_HEADER_SIZE, raw.length - 1)),
      })
    }
  }
}

function findPair(buf: readonly number[], a: number, b: number): number {
  for (let i = 0; i + 1 < buf.length; i++) {
    if (buf[i] === a && buf[i + 1] === b) return i
  }
  return -1
}

/** Size of the block a payload of this length would produce, for single-chunk messages. */
export function singleBlockSize(payloadLength: number): number {
  return BLOCK_HEADER_SIZE + CHUNK_HEADER_SIZE + enc7Length(payloadLength) + 1
}
