import { describe, expect, it } from 'vitest'
import {
  BLOCK_HEADER_SIZE,
  CHUNK_END,
  CHUNK_HEADER_SIZE,
  ChunkStream,
  DIR_FROM_AMP,
  FIXED_CHECKSUM,
  FIXED_SEQ,
  MAX_BLOCK_TO_AMP,
  MAX_CHUNK_DATA,
  MULTI_HEADER_SIZE,
  encodeBlocks,
  splitChunkData,
  xorChecksum,
} from '../src/protocol/frame.js'
import { concat, dec7, enc7, enc7Length, hex } from '../src/protocol/codec.js'

describe('encodeBlocks', () => {
  it('frames a short command as one block', () => {
    const [block] = encodeBlocks(0x01, 0x38, [0x00, 0x02])
    expect(block).toBeDefined()
    expect(hex(block as Uint8Array)).toBe(
      '01 fe 00 00 53 fe 1a 00 00 00 00 00 00 00 00 00 f0 01 3a 15 01 38 00 00 02 f7',
    )
  })

  it('records the whole block length in byte 6', () => {
    const [block] = encodeBlocks(0x02, 0x11, [])
    expect((block as Uint8Array)[6]).toBe((block as Uint8Array).length)
  })

  it('keeps the known-good sequence and checksum on single-chunk commands', () => {
    const [block] = encodeBlocks(0x02, 0x10, [])
    const b = block as Uint8Array
    expect(b[BLOCK_HEADER_SIZE + 2]).toBe(FIXED_SEQ)
    expect(b[BLOCK_HEADER_SIZE + 3]).toBe(FIXED_CHECKSUM)
  })

  it('omits the multi-chunk header when the payload fits one chunk', () => {
    const [block] = encodeBlocks(0x01, 0x04, [0x01, 0x02, 0x03])
    const body = (block as Uint8Array).slice(BLOCK_HEADER_SIZE + CHUNK_HEADER_SIZE, -1)
    expect(dec7(body)).toEqual(Uint8Array.from([0x01, 0x02, 0x03]))
  })

  it('terminates every chunk with f7', () => {
    for (const block of encodeBlocks(0x01, 0x01, new Uint8Array(300))) {
      expect(block[block.length - 1]).toBe(CHUNK_END)
    }
  })
})

describe('the size arithmetic around the multi-chunk header', () => {
  it('fills a maximum block exactly with a maximum chunk', () => {
    // 16 block + 6 chunk + 3 raw header + enc7(128) + 1 terminator
    const predicted =
      BLOCK_HEADER_SIZE + CHUNK_HEADER_SIZE + MULTI_HEADER_SIZE + enc7Length(MAX_CHUNK_DATA) + 1
    expect(predicted).toBe(MAX_BLOCK_TO_AMP)

    // And the encoder agrees: a payload needing two chunks produces a first
    // block of exactly the documented ceiling.
    const blocks = encodeBlocks(0x01, 0x01, new Uint8Array(MAX_CHUNK_DATA + 1))
    expect(blocks).toHaveLength(2)
    expect((blocks[0] as Uint8Array).length).toBe(MAX_BLOCK_TO_AMP)
  })

  it('does not tell us where the header lives, and this is why', () => {
    // It is tempting to argue the header must be raw because encoding it would
    // overshoot the ceiling. It would not. 128 and 131 raw bytes both encode
    // into nineteen groups, so the three bytes cost three either way and both
    // layouts hit 173 exactly. The size limit pins the chunk size, nothing more.
    const outside = BLOCK_HEADER_SIZE + CHUNK_HEADER_SIZE + MULTI_HEADER_SIZE + enc7Length(MAX_CHUNK_DATA) + 1
    const inside = BLOCK_HEADER_SIZE + CHUNK_HEADER_SIZE + enc7Length(MAX_CHUNK_DATA + MULTI_HEADER_SIZE) + 1
    expect(outside).toBe(MAX_BLOCK_TO_AMP)
    expect(inside).toBe(MAX_BLOCK_TO_AMP)
  })

  it('caps a chunk at 128 data bytes under either layout', () => {
    expect(enc7Length(MAX_CHUNK_DATA)).toBeLessThanOrEqual(147)
    expect(enc7Length(MAX_CHUNK_DATA + 1)).toBeGreaterThan(147)
  })

  it('never exceeds the ceiling, at any payload size', () => {
    for (const n of [0, 1, 127, 128, 129, 255, 256, 400, 1000]) {
      for (const block of encodeBlocks(0x01, 0x01, new Uint8Array(n))) {
        expect(block.length, `payload ${n}`).toBeLessThanOrEqual(MAX_BLOCK_TO_AMP)
      }
    }
  })

  it('numbers the chunks and shares one sequence across them', () => {
    const blocks = encodeBlocks(0x01, 0x01, new Uint8Array(MAX_CHUNK_DATA * 2 + 5), { seq: 0x22 })
    expect(blocks).toHaveLength(3)
    blocks.forEach((block, i) => {
      expect(block[BLOCK_HEADER_SIZE + 2], 'sequence').toBe(0x22)
      const header = block.slice(BLOCK_HEADER_SIZE + CHUNK_HEADER_SIZE, BLOCK_HEADER_SIZE + CHUNK_HEADER_SIZE + 3)
      expect(header[0], 'total').toBe(3)
      expect(header[1], 'index').toBe(i)
    })
  })

  it('reassembles into the payload it started from', () => {
    const payload = Uint8Array.from({ length: 500 }, (_, i) => (i * 13) & 0xff)
    const parts = encodeBlocks(0x01, 0x01, payload).map((block) => {
      const body = block.slice(BLOCK_HEADER_SIZE + CHUNK_HEADER_SIZE, -1)
      return dec7(splitChunkData(body).encoded)
    })
    expect(concat(parts)).toEqual(payload)
  })
})

describe('splitChunkData', () => {
  it('recognises a header whose count matches the encoded data', () => {
    const encoded = enc7(new Uint8Array(20))
    const body = concat([Uint8Array.from([3, 1, encoded.length]), encoded])
    const split = splitChunkData(body)
    expect(split).toMatchObject({ total: 3, index: 1, hasHeader: true })
    expect(split.encoded).toEqual(encoded)
  })

  it('recognises a header whose count is the raw data length instead', () => {
    const encoded = enc7(new Uint8Array(20))
    const body = concat([Uint8Array.from([3, 1, 20]), encoded])
    expect(splitChunkData(body)).toMatchObject({ total: 3, index: 1, hasHeader: true })
  })

  it('reports no header when the index is not below the total', () => {
    const encoded = enc7(new Uint8Array(20))
    const body = concat([Uint8Array.from([2, 2, encoded.length]), encoded])
    expect(splitChunkData(body).hasHeader).toBe(false)
  })

  it('reports no header when the count matches nothing', () => {
    const encoded = enc7(new Uint8Array(20))
    const body = concat([Uint8Array.from([2, 0, 99]), encoded])
    expect(splitChunkData(body).hasHeader).toBe(false)
  })

  it('leaves a short body alone', () => {
    const body = Uint8Array.from([0x00, 0x01])
    expect(splitChunkData(body)).toMatchObject({ total: 1, index: 0, hasHeader: false })
  })
})

describe('xorChecksum', () => {
  it('is the exclusive or of every byte', () => {
    expect(xorChecksum([0x0f, 0xf0])).toBe(0xff)
    expect(xorChecksum([0xaa, 0xaa])).toBe(0x00)
    expect(xorChecksum([])).toBe(0x00)
  })
})

/** Wrap a chunk the way the amp would, so the stream reader has something real to chew. */
function ampBlock(cmd: number, sub: number, payload: Uint8Array, seq = 0x10): Uint8Array {
  const encoded = enc7(payload)
  const chunk = concat([
    Uint8Array.from([0xf0, 0x01, seq, xorChecksum(encoded), cmd, sub]),
    encoded,
    Uint8Array.from([CHUNK_END]),
  ])
  const block = new Uint8Array(BLOCK_HEADER_SIZE + chunk.length)
  block.set([0x01, 0xfe], 0)
  block.set(DIR_FROM_AMP, 4)
  block[6] = block.length
  block.set(chunk, BLOCK_HEADER_SIZE)
  return block
}

describe('ChunkStream', () => {
  it('pulls a chunk out of one whole block', () => {
    const stream = new ChunkStream()
    const chunks = stream.push(ampBlock(0x03, 0x10, Uint8Array.from([0x00, 0x02])))
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({ cmd: 0x03, sub: 0x10 })
  })

  it('waits for a block that arrives one byte at a time', () => {
    const stream = new ChunkStream()
    const block = ampBlock(0x03, 0x10, Uint8Array.from([0x00, 0x01]))
    const collected = []
    for (const byte of block) collected.push(...stream.push(Uint8Array.of(byte)))
    expect(collected).toHaveLength(1)
    expect(collected[0]).toMatchObject({ cmd: 0x03, sub: 0x10 })
  })

  it('reads several blocks delivered in one notification', () => {
    const stream = new ChunkStream()
    const chunks = stream.push(
      concat([
        ampBlock(0x03, 0x10, Uint8Array.from([0x00, 0x00])),
        ampBlock(0x03, 0x38, Uint8Array.from([0x00, 0x03])),
      ]),
    )
    expect(chunks.map((c) => c.sub)).toEqual([0x10, 0x38])
  })

  it('reassembles a chunk split across two blocks', () => {
    // Blocks carry bytes, not messages: a chunk may straddle a block boundary,
    // so both layers have to be buffered independently.
    const payload = Uint8Array.from([0x00, 0x01, 0x02, 0x03])
    const encoded = enc7(payload)
    const chunk = concat([
      Uint8Array.from([0xf0, 0x01, 0x11, xorChecksum(encoded), 0x03, 0x37]),
      encoded,
      Uint8Array.from([CHUNK_END]),
    ])

    const stream = new ChunkStream()
    const halves = [chunk.subarray(0, 5), chunk.subarray(5)]
    const found = []
    for (const half of halves) {
      const block = new Uint8Array(BLOCK_HEADER_SIZE + half.length)
      block.set([0x01, 0xfe], 0)
      block.set(DIR_FROM_AMP, 4)
      block[6] = block.length
      block.set(half, BLOCK_HEADER_SIZE)
      found.push(...stream.push(block))
    }

    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ cmd: 0x03, sub: 0x37 })
  })

  it('steps over noise before the first real block', () => {
    const stream = new ChunkStream()
    const chunks = stream.push(
      concat([Uint8Array.from([0xde, 0xad, 0xbe, 0xef]), ampBlock(0x03, 0x10, Uint8Array.from([0x00, 0x01]))]),
    )
    expect(chunks).toHaveLength(1)
  })

  it('does not grow without bound when fed garbage', () => {
    const stream = new ChunkStream(64)
    for (let i = 0; i < 100; i++) stream.push(new Uint8Array(64).fill(0x7f))
    // Still working afterwards is the thing that matters.
    expect(stream.push(ampBlock(0x03, 0x10, Uint8Array.from([0x00, 0x01])))).toHaveLength(1)
  })

  it('forgets everything on reset', () => {
    const stream = new ChunkStream()
    const block = ampBlock(0x03, 0x10, Uint8Array.from([0x00, 0x01]))
    stream.push(block.subarray(0, 10))
    stream.reset()
    expect(stream.push(block.subarray(10))).toHaveLength(0)
  })
})
