/**
 * Wire primitives for the Spark protocol: the 7-bit transport encoding and the
 * MessagePack-flavoured value types layered on top of it.
 *
 * Everything here is pure. No DOM, no Bluetooth, no async. Bytes in, values out.
 *
 * Two details in this file are the ones most likely to bite, so they are stated
 * up front:
 *
 *  - Floats are IEEE-754 **big-endian**, tagged `ca`.
 *  - Strings come in two flavours. Presets carry *plain* strings; commands carry
 *    *prefixed* strings, where the length is written twice (bare, then again as
 *    `0xa0 + len`). Sending one where the other is expected produces a command
 *    the amp ignores without complaint, which is a miserable thing to debug.
 */

/** Thrown whenever a read would run off the end of a buffer, or a tag byte is not what it must be. */
export class ProtocolError extends Error {
  readonly offset: number

  constructor(message: string, offset: number) {
    super(`${message} (at offset ${offset})`)
    this.name = 'ProtocolError'
    this.offset = offset
  }
}

/**
 * Pack bytes 7 bits at a time. Each group of up to 7 bytes is emitted as a mask
 * byte followed by the group with bit 7 stripped; the mask records which of them
 * had that bit set.
 */
export function enc7(data: Uint8Array | readonly number[]): Uint8Array {
  const src = data instanceof Uint8Array ? data : Uint8Array.from(data)
  const out = new Uint8Array(enc7Length(src.length))
  let o = 0

  for (let i = 0; i < src.length; i += 7) {
    const group = Math.min(7, src.length - i)
    const maskAt = o++
    let mask = 0
    for (let j = 0; j < group; j++) {
      const b = src[i + j] as number
      if (b & 0x80) mask |= 1 << j
      out[o++] = b & 0x7f
    }
    out[maskAt] = mask
  }

  return out
}

/** Inverse of {@link enc7}. Trailing bytes that do not complete a group are decoded as far as they go. */
export function dec7(data: Uint8Array | readonly number[]): Uint8Array {
  const src = data instanceof Uint8Array ? data : Uint8Array.from(data)
  const out: number[] = []

  for (let i = 0; i < src.length; i += 8) {
    const mask = src[i] as number
    for (let j = 0; j < 7 && i + 1 + j < src.length; j++) {
      const b = src[i + 1 + j] as number
      out.push(mask & (1 << j) ? b | 0x80 : b)
    }
  }

  return Uint8Array.from(out)
}

/** Encoded size of `n` raw bytes: one mask byte per group of seven. */
export function enc7Length(n: number): number {
  return n + Math.ceil(n / 7)
}

/** Decoded size of `n` encoded bytes. Inverse of {@link enc7Length}. */
export function dec7Length(n: number): number {
  return n - Math.ceil(n / 8)
}

/* ── value tags ───────────────────────────────────────────────────────────── */

export const TAG = {
  FALSE: 0xc2,
  TRUE: 0xc3,
  FLOAT32: 0xca,
  STR8: 0xd9,
  /** Short strings are `0xa0 + len`, for len 0..31. */
  FIXSTR_BASE: 0xa0,
  FIXSTR_MAX: 0xbf,
  /** Arrays are `0x90 + count`, for count 0..15. */
  FIXARRAY_BASE: 0x90,
  FIXARRAY_MAX: 0x9f,
  /** Sits between a parameter's index and its value. */
  PARAM_SEPARATOR: 0x91,
} as const

/* ── reading ──────────────────────────────────────────────────────────────── */

/**
 * A bounds-checked cursor over decoded bytes.
 *
 * Every read validates against the end of the buffer before touching it. This is
 * not defensive habit for its own sake: a length byte taken from the wire and
 * trusted is how you walk off the end of a buffer, and the amp has been observed
 * to wedge until it is power-cycled when it is fed nonsense. Bound every read.
 */
export class Reader {
  readonly #data: Uint8Array
  #pos: number

  constructor(data: Uint8Array, start = 0) {
    this.#data = data
    this.#pos = start
  }

  get pos(): number {
    return this.#pos
  }

  get remaining(): number {
    return this.#data.length - this.#pos
  }

  get atEnd(): boolean {
    return this.#pos >= this.#data.length
  }

  /** Throws unless at least `n` bytes remain. */
  need(n: number, what: string): void {
    if (this.remaining < n) {
      throw new ProtocolError(`need ${n} byte(s) for ${what}, have ${this.remaining}`, this.#pos)
    }
  }

  /** The byte `ahead` positions from the cursor, or -1 if that is past the end. */
  peek(ahead = 0): number {
    const i = this.#pos + ahead
    return i < this.#data.length ? (this.#data[i] as number) : -1
  }

  u8(what = 'byte'): number {
    this.need(1, what)
    return this.#data[this.#pos++] as number
  }

  bytes(n: number, what = 'bytes'): Uint8Array {
    this.need(n, what)
    const out = this.#data.subarray(this.#pos, this.#pos + n)
    this.#pos += n
    return out
  }

  /** Reads a `ca`-tagged big-endian float32. */
  f32(what = 'float'): number {
    const tag = this.u8(`${what} tag`)
    if (tag !== TAG.FLOAT32) {
      throw new ProtocolError(`expected float tag ca for ${what}, got ${hex1(tag)}`, this.#pos - 1)
    }
    this.need(4, what)
    const view = new DataView(this.#data.buffer, this.#data.byteOffset + this.#pos, 4)
    this.#pos += 4
    return view.getFloat32(0, false)
  }

  /** Reads a `c3`/`c2` boolean. */
  bool(what = 'boolean'): boolean {
    const tag = this.u8(what)
    if (tag !== TAG.TRUE && tag !== TAG.FALSE) {
      throw new ProtocolError(`expected c2/c3 for ${what}, got ${hex1(tag)}`, this.#pos - 1)
    }
    return tag === TAG.TRUE
  }

  /** Reads a `0x90 + n` array marker and returns n. */
  arrayLen(what = 'array'): number {
    const tag = this.u8(what)
    if (tag < TAG.FIXARRAY_BASE || tag > TAG.FIXARRAY_MAX) {
      throw new ProtocolError(`expected array marker for ${what}, got ${hex1(tag)}`, this.#pos - 1)
    }
    return tag - TAG.FIXARRAY_BASE
  }

  /** Reads a plain string: `0xa0 + len` for short, `d9 len` for long. This is the form presets use. */
  str(what = 'string'): string {
    const tag = this.u8(`${what} tag`)
    if (tag >= TAG.FIXSTR_BASE && tag <= TAG.FIXSTR_MAX) {
      return this.#text(tag - TAG.FIXSTR_BASE, what)
    }
    if (tag === TAG.STR8) {
      return this.#text(this.u8(`${what} length`), what)
    }
    throw new ProtocolError(`expected string tag for ${what}, got ${hex1(tag)}`, this.#pos - 1)
  }

  /**
   * Reads a prefixed string: a bare length, then the same length again as a
   * string tag, then the bytes. This is the form commands use for effect names.
   */
  pstr(what = 'prefixed string'): string {
    const len = this.u8(`${what} length`)
    const tag = this.u8(`${what} tag`)
    if (tag === TAG.FIXSTR_BASE + len) return this.#text(len, what)
    if (tag === TAG.STR8) {
      const len2 = this.u8(`${what} length repeat`)
      if (len2 !== len) {
        throw new ProtocolError(`${what} length mismatch: ${len} then ${len2}`, this.#pos - 1)
      }
      return this.#text(len, what)
    }
    throw new ProtocolError(
      `expected string tag ${hex1(TAG.FIXSTR_BASE + len)} or d9 for ${what}, got ${hex1(tag)}`,
      this.#pos - 1,
    )
  }

  /**
   * Reads a string in whichever of the two forms is actually present.
   *
   * The disambiguation is exact rather than a guess: a prefixed string repeats
   * its length, so `len` followed by `0xa0 + len` cannot be confused with a
   * plain string, whose first byte is already `>= 0xa0`.
   *
   * Used only for amp → app messages, where community sources do not agree on
   * which form the amp uses. Once captured fixtures settle it, callers should
   * move to {@link str} or {@link pstr} and this should go away.
   */
  anyStr(what = 'string'): string {
    const first = this.peek()
    if (first >= TAG.FIXSTR_BASE || first === TAG.STR8) return this.str(what)
    if (this.peek(1) === TAG.FIXSTR_BASE + first || this.peek(1) === TAG.STR8) return this.pstr(what)
    throw new ProtocolError(`no recognisable string at ${what}`, this.#pos)
  }

  #text(len: number, what: string): string {
    this.need(len, `${what} body`)
    const bytes = this.#data.subarray(this.#pos, this.#pos + len)
    this.#pos += len
    return new TextDecoder().decode(bytes)
  }
}

/* ── writing ──────────────────────────────────────────────────────────────── */

/** Accumulates bytes for a payload. Mirrors {@link Reader}. */
export class Writer {
  readonly #out: number[] = []

  get length(): number {
    return this.#out.length
  }

  u8(...bytes: number[]): this {
    for (const b of bytes) this.#out.push(b & 0xff)
    return this
  }

  raw(bytes: Uint8Array | readonly number[]): this {
    for (const b of bytes) this.#out.push(b & 0xff)
    return this
  }

  f32(value: number): this {
    const buf = new ArrayBuffer(4)
    new DataView(buf).setFloat32(0, value, false)
    this.#out.push(TAG.FLOAT32, ...new Uint8Array(buf))
    return this
  }

  bool(value: boolean): this {
    this.#out.push(value ? TAG.TRUE : TAG.FALSE)
    return this
  }

  arrayLen(n: number): this {
    if (n < 0 || n > 15) throw new RangeError(`array marker only encodes 0..15, got ${n}`)
    this.#out.push(TAG.FIXARRAY_BASE + n)
    return this
  }

  /** Writes a plain string — the form presets use. */
  str(value: string): this {
    const bytes = new TextEncoder().encode(value)
    if (bytes.length <= 31) this.#out.push(TAG.FIXSTR_BASE + bytes.length)
    else if (bytes.length <= 0xff) this.#out.push(TAG.STR8, bytes.length)
    else throw new RangeError(`string too long to encode: ${bytes.length} bytes`)
    this.#out.push(...bytes)
    return this
  }

  /** Writes a prefixed string — the form commands use for effect names. */
  pstr(value: string): this {
    const bytes = new TextEncoder().encode(value)
    if (bytes.length > 31) throw new RangeError(`prefixed string too long: ${bytes.length} bytes`)
    this.#out.push(bytes.length, TAG.FIXSTR_BASE + bytes.length, ...bytes)
    return this
  }

  toBytes(): Uint8Array {
    return Uint8Array.from(this.#out)
  }
}

/* ── small helpers ────────────────────────────────────────────────────────── */

export function hex1(b: number): string {
  return b.toString(16).padStart(2, '0')
}

export function hex(bytes: Uint8Array | readonly number[]): string {
  return Array.from(bytes, hex1).join(' ')
}

export function fromHex(text: string): Uint8Array {
  const cleaned = text.replace(/[^0-9a-fA-F]/g, '')
  if (cleaned.length % 2 !== 0) throw new Error('hex string has an odd number of digits')
  const out = new Uint8Array(cleaned.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16)
  return out
}

export function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}
