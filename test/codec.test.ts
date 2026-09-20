import { describe, expect, it } from 'vitest'
import {
  ProtocolError,
  Reader,
  Writer,
  dec7,
  dec7Length,
  enc7,
  enc7Length,
  fromHex,
  hex,
} from '../src/protocol/codec.js'

describe('7-bit encoding', () => {
  it('prefixes each group of seven with a mask of their high bits', () => {
    const data = Uint8Array.from([0x80, 0x01, 0xff, 0x02, 0x03, 0x04, 0x05])
    // Bits 0, 2 set: bytes 0 and 2 had their high bit stripped.
    expect(hex(enc7(data))).toBe('05 00 01 7f 02 03 04 05')
  })

  it('emits nothing for empty input', () => {
    expect(enc7([]).length).toBe(0)
    expect(dec7([]).length).toBe(0)
  })

  it('handles a trailing partial group', () => {
    const data = Uint8Array.from([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x11, 0x22])
    expect(dec7(enc7(data))).toEqual(data)
  })

  it('round-trips every byte value', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i)
    expect(dec7(enc7(all))).toEqual(all)
  })

  it('round-trips at every length across group boundaries', () => {
    for (let n = 0; n <= 40; n++) {
      const data = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 0x80) & 0xff)
      expect(dec7(enc7(data)), `length ${n}`).toEqual(data)
    }
  })

  it('reports encoded and decoded sizes that agree with the encoder', () => {
    for (let n = 0; n <= 200; n++) {
      const encoded = enc7(new Uint8Array(n))
      expect(encoded.length, `enc7Length(${n})`).toBe(enc7Length(n))
      expect(dec7Length(encoded.length), `dec7Length for ${n}`).toBe(n)
    }
  })
})

describe('Writer and Reader', () => {
  it('round-trips a float as big-endian', () => {
    const bytes = new Writer().f32(0.5).toBytes()
    expect(hex(bytes)).toBe('ca 3f 00 00 00')
    expect(new Reader(bytes).f32()).toBe(0.5)
  })

  it('round-trips booleans', () => {
    expect(hex(new Writer().bool(true).bool(false).toBytes())).toBe('c3 c2')
    const r = new Reader(fromHex('c3 c2'))
    expect(r.bool()).toBe(true)
    expect(r.bool()).toBe(false)
  })

  it('writes short strings with a single length byte', () => {
    expect(hex(new Writer().str('abc').toBytes())).toBe('a3 61 62 63')
    expect(new Reader(fromHex('a3 61 62 63')).str()).toBe('abc')
  })

  it('writes long strings with the d9 tag', () => {
    const long = 'x'.repeat(40)
    const bytes = new Writer().str(long).toBytes()
    expect(bytes[0]).toBe(0xd9)
    expect(bytes[1]).toBe(40)
    expect(new Reader(bytes).str()).toBe(long)
  })

  it('writes the length twice for prefixed strings', () => {
    expect(hex(new Writer().pstr('abc').toBytes())).toBe('03 a3 61 62 63')
    expect(new Reader(fromHex('03 a3 61 62 63')).pstr()).toBe('abc')
  })

  it('tells prefixed and plain strings apart without guessing', () => {
    expect(new Reader(new Writer().pstr('Twin').toBytes()).anyStr()).toBe('Twin')
    expect(new Reader(new Writer().str('Twin').toBytes()).anyStr()).toBe('Twin')
  })

  it('round-trips names with a space, which the catalogue contains', () => {
    const bytes = new Writer().pstr('AC Boost').toBytes()
    expect(new Reader(bytes).pstr()).toBe('AC Boost')
  })

  it('round-trips array markers', () => {
    expect(hex(new Writer().arrayLen(7).toBytes())).toBe('97')
    expect(new Reader(fromHex('97')).arrayLen()).toBe(7)
  })
})

describe('Reader bounds checking', () => {
  it('refuses to read past the end rather than returning rubbish', () => {
    const r = new Reader(fromHex('ca 3f 00'))
    expect(() => r.f32()).toThrow(ProtocolError)
  })

  it('refuses a string whose length runs off the end', () => {
    // Claims twenty bytes; three follow. This is the shape that hangs the amp.
    expect(() => new Reader(fromHex('b4 61 62 63')).str()).toThrow(ProtocolError)
  })

  it('refuses a long string whose length runs off the end', () => {
    expect(() => new Reader(fromHex('d9 ff 61')).str()).toThrow(ProtocolError)
  })

  it('rejects a prefixed string whose two lengths disagree', () => {
    expect(() => new Reader(fromHex('03 d9 05 61 62 63 64 65')).pstr()).toThrow(ProtocolError)
  })

  it('reports where it gave up', () => {
    try {
      new Reader(fromHex('a5 61')).str()
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ProtocolError)
      expect((error as ProtocolError).offset).toBeGreaterThan(0)
    }
  })

  it('peeks past the end without throwing', () => {
    expect(new Reader(fromHex('01')).peek(5)).toBe(-1)
  })
})

describe('hex helpers', () => {
  it('round-trips', () => {
    const bytes = Uint8Array.from([0x00, 0x0f, 0xff, 0xa5])
    expect(hex(bytes)).toBe('00 0f ff a5')
    expect(fromHex(hex(bytes))).toEqual(bytes)
  })

  it('ignores separators when parsing', () => {
    expect(fromHex('01fe\n00:00')).toEqual(Uint8Array.from([0x01, 0xfe, 0x00, 0x00]))
  })

  it('rejects an odd number of digits', () => {
    expect(() => fromHex('abc')).toThrow()
  })
})
