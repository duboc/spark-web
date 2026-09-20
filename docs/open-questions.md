# Open questions

Six things this project does not know. Each one has a way to settle it, and each
one needs bytes from a real Spark 40.

Read this before you change `src/protocol/`. Several of these look settled in
the code and are not.

## How to capture

1. Connect to the amp.
2. Switch on **Protocol log** and **Raw hex**.
3. Do the thing you want to record.
4. Select **Save capture**, and put the file in `test/fixtures/`.

A capture holds every byte in both directions with a timestamp. `ReplayTransport`
plays one back, so a fixture becomes a test that runs with no amp.

Capture these six sessions first: the connect handshake, each of the four
presets, one knob turned on the amp, one preset button pressed on the amp, one
effect toggled, and one amp model swapped.

## 1. Where the chunk header sits

Multi-chunk messages prefix each chunk's data with three bytes: `[total, index,
count]`. Sources disagree on whether those three bytes sit inside or outside the
7-bit encoded region.

The size limits look like they settle this. They do not. Both layouts land on
exactly the documented 173-byte ceiling:

```
outside:  16 + 6 + 3 + enc7(128)     + 1 = 16 + 6 + 3 + 147 + 1 = 173
inside:   16 + 6     + enc7(128 + 3) + 1 = 16 + 6     + 150 + 1 = 173
```

128 and 131 raw bytes both encode into nineteen groups, so the three header bytes
cost three either way. The arithmetic fixes the chunk size at 128 bytes and tells
you nothing else.

So this project sends the header raw and outside, because that is what the
working clients do, and detects it on receive. `splitChunkData` in
`src/protocol/frame.ts` accepts the header only when all three bytes agree with
each other and with the length that follows. That is a check rather than the
prototype's decode-twice-and-keep-what-parses, but it is still a detection.

**Settle it:** read one multi-chunk preset from a capture. Count the bytes
between the chunk header and the `f7`. Replace the detection with a constant.

**Also open:** whether single-chunk messages from the amp carry the header at
all.

## 2. The sequence and checksum bytes

This project sends the literal `3a 15` for the sequence and checksum on
single-chunk commands, because working clients have sent exactly that for years.
Multi-chunk messages use a rolling sequence, which they must, since the sequence
is what groups the chunks of one message together. Their checksum is the
exclusive or of the chunk's encoded data bytes.

The amp is reported not to validate either byte.

**Settle it:** send a command with a deliberately wrong checksum and see whether
the amp acts on it. Then read the sequence and checksum bytes the amp sends on a
multi-chunk preset, and check the exclusive or against the data.

## 3. Write mode and MTU

`BleTransport` prefers `writeValueWithoutResponse` and falls back to
`writeValue` when Chrome rejects the write. A preset upload produces blocks near
the 173-byte ceiling, and Chrome may fragment them.

**Settle it:** upload a preset over Bluetooth and watch whether the amp accepts
it. If it does not, try acknowledged writes only, then try splitting each block
across several writes.

## 4. The minimum gap between commands

Community guidance says 500 ms between commands. That is far too slow for a
slider drag, so `src/protocol/commands.ts` uses 45 ms for parameters and up to
400 ms for preset queries — roughly a tenth of the guidance.

These numbers are not measured. They are what the prototype used without
apparent trouble.

**Settle it:** bisect. Raise `gapScale` on `AmpController` if the amp turns
flaky, and lower it until it does. Record the number where it breaks, not the
number that works.

## 5. What each knob does

Only the amp's five knobs are documented: gain, treble, mid, bass, master. Every
other effect has four to six parameters, and nothing records what they mean.

`knobLabel` in `src/protocol/catalog.ts` shows `P1`, `P2` and so on for all of
them, which is honest and useless.

**Settle it:** open the official app, turn one knob, and watch which parameter
index moves in an `03 37` message. Repeat for each effect. Dump every preset
first to learn how many parameters each model has.

## 6. The reverb type

Reverb is always `bias.reverb`. The room — hall, plate, spring and the rest — is
a float in parameter index 6 rather than a model swap. Which float means which
room is unmeasured.

**Settle it:** change the reverb type in the official app and record the float
at index 6 for each one. There are a small number of discrete values.

## What captures cannot tell you

A capture records one firmware version on one amp. It proves that the amp
answered these bytes this way, on this day. It does not prove that a different
Spark, or the same Spark after an update, answers the same way.

That is a good reason to keep `src/protocol/` isolated: when a firmware update
changes something, the fix stays inside one directory.
