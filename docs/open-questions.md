# Open questions

What this project knows, and what it still does not.

Read this before you change `src/protocol/`. Four questions are now settled from
bytes captured off a Spark 40, serial S040CD381342. Three of the answers
contradict the community documentation this project was built from, so if you
"correct" the code back towards the documentation, `test/hardware.test.ts` fails.

## How to capture

1. Connect to the amp.
2. Do the thing you want to record.
3. Select **Save capture**, and put the file in `test/fixtures/`.

The recorder writes every byte in both directions with a timestamp, whether or
not the on-screen log is switched on. To read one back:

```sh
npx vite-node tools/analyse-capture.ts -- test/fixtures/<file>.capture.json
```

## Settled

### 1. The chunk header sits inside the encoded region

Multi-chunk messages prefix each chunk's data with `[total, index, count]`, and
those three bytes go through the 7-bit encoder with the data. You decode first,
then read the header. `count` counts decoded bytes.

The size limits look as though they settle this, and they do not. Both layouts
land on exactly the 173-byte ceiling, because 128 and 131 raw bytes both encode
into nineteen groups:

```
outside:  16 + 6 + 3 + enc7(128)     + 1 = 173
inside:   16 + 6     + enc7(128 + 3) + 1 = 173
```

The capture settles it. Each chunk of a preset reply decodes to bytes beginning
`0f 00 19`, `0f 01 19`, `0f 02 19` and so on — fifteen chunks, numbered, each
declaring 25 bytes, each decoding to exactly 28. The data after the header begins
`00 00 d9 24`: lead byte, channel 0, a 36-character string. That is how a preset
starts, and reading the header from the raw body instead produces nothing that
parses.

Single-chunk replies carry no header at all.

### 2. The amp computes the checksum byte

Byte 3 of a chunk header is the exclusive or of the chunk body. That holds for
all 234 chunks in the capture, so this project computes it too rather than
sending the fixed `15` that older clients send.

**The sequence byte does not group anything.** It is `3a` on everything, in both
directions, including all fifteen chunks of a preset. `MessageAssembler`
therefore keys partial messages by command and sub-command. Keying by the
sequence byte appears to work, because the amp never has two messages of one kind
in flight, but it is keying on a constant.

### 3. The preset checksum is a plain sum

Every byte after the channel, summed modulo 256. The community rule adds a clause
substituting `0xCC` for any byte above 127; that clause is wrong on this
firmware. The two rules genuinely differ, since a preset is full of bytes above
127 such as the `d9` and `ca` type tags, and the plain sum reproduces the stored
byte on all five distinct presets while the `0xCC` variant reproduces none.

### 4. The live state has its own lead byte

A reply about a stored preset starts `00`. A reply to a live-state request starts
`01`, and then carries the channel of the slot the sound came from rather than
the `7f` the notes describe. Both forms parse; `Preset.live` records which.

## Still open

### 5. What each knob does

`src/protocol/knobs.ts` now carries labels for every effect, taken from two
independent client implementations that were read directly and that agree with
each other on almost every entry.

**The parameter counts are verified; the names are not.** The counts in the
capture match those catalogues exactly — one parameter on `Booster`, two on
`Compressor`, `Phaser` and `Cloner`, three on `Flanger` and the noise gate, four
on `ChorusAnalog`, five on `DelayMono` and every amp, eight on `bias.reverb`.
That is real corroboration, and it is not the same as confirming that a knob is
called "Sensitivity". No capture can tell you a name.

Seven parameters have no name in any source and show as `P4` and so on. They are
left blank on purpose.

**Settle it:** open the official app, turn one knob, and watch which index moves
in an `03 37` message. This needs a second Bluetooth client, because the control
link takes one at a time.

**Also unexplained:** `DistortionTS9` appears with three parameters in one preset
and four in another, and `bias.reverb` with seven in one and eight in another.
Nothing accounts for that yet.

### 6. The reverb rooms

Parameter index 6 selects the room as a float. The nine values are confirmed by
two implementations that arrive at them independently, and are in
`REVERB_ROOMS`. Three of the *names* differ between sources, and both
alternatives are recorded rather than adjudicated.

There is no spring reverb, despite the protocol notes saying "hall, plate,
spring". That phrase is prose, not a list.

**Settle it:** change the room in the official app and record the float.

### 7. Write mode and MTU

`BleTransport` prefers `writeValueWithoutResponse` and falls back to
`writeValue`. A preset upload produces blocks near the 173-byte ceiling, and
Chrome may fragment them. No preset has been uploaded to real hardware yet.

**Settle it:** upload a preset over Bluetooth and see whether the amp takes it.

### 8. The minimum gap between commands

Community guidance says 500 ms. This project uses 45 ms for parameter changes and
up to 400 ms for preset queries. Those numbers are not measured; they are what
the prototype used without apparent trouble.

**Settle it:** bisect with `gapScale` on `AmpController`, and record the number
where it breaks rather than one that works.

### 9. A stray byte in the serial number

The serial number reply decodes to a prefixed string of length 13 whose
thirteenth byte is `f7` — the chunk terminator, encoded, inside the string. The
serial itself is twelve characters. Either the amp includes the terminator in the
length, or the framing is off by one in a way that happens not to matter. It
parses, and the extra character is cosmetic, so it is recorded rather than fixed.

## What captures cannot tell you

A capture records one firmware version on one amp, on one day. It does not prove
a different Spark, or the same Spark after an update, behaves the same way.

That is a good reason to keep `src/protocol/` isolated: when a firmware update
changes something, the fix stays in one directory.
