# The Spark protocol

What goes over the Bluetooth control link. The framing borrows from MIDI SysEx
and the payload encoding borrows from MessagePack, but neither specification is
followed exactly, so read this rather than either of those.

This document records what the community established. Where this project knows
something is unverified, `docs/open-questions.md` says so.

## Endpoints

| Item | UUID |
| --- | --- |
| Service | `0000ffc0-0000-1000-8000-00805f9b34fb` |
| Write | characteristic `ffc1` |
| Notify | characteristic `ffc2` |

You connect like this:

1. Call `requestDevice`, filtering on service `ffc0`, or on the name prefix
   `Spark` with `ffc0` in `optionalServices`.
2. Connect to the GATT server.
3. Get the primary service `ffc0`.
4. Get both characteristics.
5. Start notifications on `ffc2`.

`requestDevice` needs a user gesture, so the page has a Connect button and cannot
reconnect on load.

## Blocks

Every message travels inside one or more blocks.

```
0-1    01 fe      start marker
2-3    00 00      reserved
4-5    53 fe      app to amp
       41 ff      amp to app
6      size       the whole block, including these 16 bytes
7-15   00 x 9     padding
```

A block to the amp is at most 173 bytes (`0xad`). A block from the amp is at most
106 bytes (`0x6a`).

## Chunks

Inside the blocks sits a chunk.

```
0-1    f0 01      start marker
2      seq        always 3a; it groups nothing, despite the name
3      checksum   exclusive or of the body
4      cmd
5      sub
...    data       7-bit encoded, see below
last   f7         terminator
```

A chunk carries at most 128 data bytes before encoding. Multi-chunk messages
prefix each chunk's data with three more bytes: `[total, index, count]`, and
those three go through the encoder with the data. You decode first, then read
the header. `count` counts decoded bytes. Single-chunk messages carry no header.

Byte 3 is the exclusive or of the chunk body; the amp computes it. Byte 2, the
sequence, is `3a` on everything in both directions, so it groups nothing.

A block from the amp is smaller than a full chunk, so chunks straddle block
boundaries. Buffer the whole byte stream, strip the 16-byte block headers, then
scan the result for `f0 01 … f7`. Never treat one notification as one message.

## The 7-bit encoding

Data travels seven bits at a time. Each group of up to seven bytes gets a mask
byte in front of it.

To encode: for each group of seven bytes, build a mask. For each byte with bit 7
set, set the matching bit in the mask and clear bit 7 of the byte. Write the
mask, then the seven stripped bytes.

To decode: read the mask, then set bit 7 on each of the next seven bytes where
the matching mask bit is set.

`n` raw bytes encode into `n + ceil(n / 7)` bytes.

## Value types

These apply after you decode to 8-bit.

| Type | Format |
| --- | --- |
| True, false | `c3`, `c2` |
| Float | `ca` then four bytes, IEEE-754, big-endian |
| Short string | `0xa0 + len` then the bytes |
| Prefixed string | `len` then `0xa0 + len` then the bytes |
| Long string | `d9` then `len` then the bytes |
| Array | `0x90 + count` |
| Parameter separator | `91` |
| Small number | the raw byte |

Every parameter value is a float from 0.0 to 1.0, even where the amp's knobs are
marked 0 to 10.

Commands write effect names as **prefixed** strings, where the length appears
twice. Presets write **plain** strings. Getting this backwards produces a command
the amp ignores without complaint, which is the worst failure mode available.

## Commands you send

| cmd | sub | Action | Payload |
| --- | --- | --- | --- |
| `01` | `01` | Send a whole preset | the preset, across several chunks. Lead byte `01` with the selected channel; `7f` is acknowledged and discarded |
| `01` | `04` | Change an effect knob | prefixed name, index, float |
| `01` | `06` | Swap an effect | prefixed name, prefixed name |
| `01` | `15` | Toggle an effect | prefixed name, `c3` or `c2` |
| `01` | `38` | Switch preset | `00` then 0-3 |
| `03` | `06` | Swap the amp model | prefixed name, prefixed name |
| `03` | `27` | Store the live sound to a slot | `00` then 0-3 |
| `03` | `37` | Change an amp knob | prefixed name, index, float |
| `02` | `01` | Ask for a preset | `00` then 0-3, or `01 00` for the live sound |
| `02` | `10` | Ask which preset is selected | none |
| `02` | `11` | Ask for the amp's name | none |
| `02` | `23` | Ask for the serial number | none |

The amp slot is special. Parameter changes and model swaps on slot 3 use command
`03`, sub `37` and `06`. Every other slot uses command `01`, sub `04` and `06`.

## Messages you receive

| cmd | sub | Meaning |
| --- | --- | --- |
| `03` | `01` | A preset, across several chunks |
| `03` | `06` | An effect or amp model changed |
| `03` | `10` | Which preset is selected |
| `03` | `15` | An effect was toggled |
| `03` | `27` | A preset was stored |
| `03` | `37` | Somebody turned a knob on the amp |
| `03` | `38` | Somebody pressed a preset button on the amp |
| `03` | `63` | The tempo changed |
| `04` | any | An acknowledgement; the sub mirrors what it acknowledges |
| `05` | any | Also an acknowledgement. Seen three times before an `04 01` while a multi-chunk upload was in flight, so it may mean "chunk taken, send the next". Unconfirmed. |

`03 37` and `03 38` are what make the page follow the hardware. Wire them up
early.

The amp does not acknowledge a parameter change. Do not build anything that
waits for one.

## The preset

```
00 or 01        00 on a stored preset, 01 on the live state
channel         00-03 for a hardware slot
uuid            string, 36 characters
name            string
version         string
description     string
icon            string
bpm             float
97              array marker: seven pedals follow
  x 7:
    name        string
    c3 or c2    on or off
    90 + n      parameter count
      x n:
        index   raw byte
        91      separator
        value   float
loudness        float, on some presets
extra gain      float, on some presets
checksum        one byte
```

The checksum sums every byte after the channel, modulo 256. Community notes add
a clause substituting `0xCC` for any byte above 127; that clause is wrong on the
firmware captured here. The amp tolerates a wrong value. The official app does
not.

## The signal chain

Seven slots in a fixed order. You change what sits in a slot. You never reorder
them.

| Slot | Kind |
| --- | --- |
| 0 | Gate |
| 1 | Comp |
| 2 | Drive |
| 3 | Amp |
| 4 | Mod |
| 5 | Delay |
| 6 | Reverb |

The amp's knobs are index 0 gain, 1 treble, 2 mid, 3 bass, 4 master.
`src/protocol/knobs.ts` carries labels for the other effects, with a note on
where each one comes from and how far to trust it.

Reverb is always `bias.reverb`. The room is a float in parameter index 6 rather
than a model swap. `REVERB_ROOMS` lists the nine values.

## Model names

`src/protocol/catalog.ts` holds every DSP name and the display name that goes
with it. The DSP name is what goes on the wire. One of them, `AC Boost`,
contains a space, which is not a mistake.

## Timing

Community guidance is 500 ms between commands. This project uses 45 ms for
parameter changes and up to 400 ms for preset queries, which is roughly a tenth
of that and has not been measured against hardware. If the amp turns flaky,
raise `gapScale` on `AmpController` before suspecting anything else.

After the last chunk of a multi-chunk reply, wait about 300 ms before you act on
it.

On connect, ask in this order: the amp's name, the serial number, which preset
is selected, presets 0 to 3, then the live sound.

## Things that can go wrong

Malformed messages can wedge the amp until you power-cycle it. Bound every read.
Never trust a length byte from the wire without checking it against the bytes you
actually have.

Storing to a slot destroys what was there. You cannot undo it.

Web Bluetooth drops connections when the machine sleeps. Handle
`gattserverdisconnected` and offer to reconnect rather than writing to a dead
handle.
