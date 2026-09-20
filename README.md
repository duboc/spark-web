# Spark Web

Control a Positive Grid Spark 40 from your browser, over Web Bluetooth.

No account, no cloud, no install. Your presets are JSON files on your disk, so
you can keep them in a repository, diff two of them, and send one to somebody
else.

This is unofficial software. Positive Grid does not publish this protocol, and a
firmware update can change it.

## What works

- Connect to the amp and read its name, serial number and all four presets.
- Switch presets, from the page or with the number keys `1` to `4`.
- Bypass any of the seven slots, swap the model in a slot, and move every knob.
- Follow the hardware. Turn a knob on the amp and the page follows it.
- Save the live sound to a file, and send a file back to the amp.
- Overwrite a hardware preset slot.
- Record a session as hex and save it, so the bytes become a test fixture.

You can run the whole interface with no amp. Select **Try without an amp** to
drive a simulated Spark that answers the same protocol.

## Before you connect

Your amp presents two separate Bluetooth links, and you treat them differently.

1. Pair **Spark 40 Audio** in your operating system's Bluetooth settings. That
   link carries music and backing tracks.
2. Leave **Spark 40 BLE** unpaired. It is the control link, and the browser
   claims it directly. If you pair it in your operating system, the browser's
   device chooser usually comes up empty.

Both links work at the same time.

## Requirements

Web Bluetooth runs in Chrome and Edge, on Windows, macOS, Linux and Android.
Safari and Firefox do not implement it, and no browser on iOS does.

Web Bluetooth also needs a secure context, so you serve the page over
`localhost` or `https`. Opening the file directly does not work.

On Linux you need BlueZ. If the chooser lists no devices, enable
`chrome://flags/#enable-experimental-web-platform-features`.

## Run it

```sh
npm install
npm run dev
```

Open `http://localhost:5173`.

```sh
npm test         # the protocol and the whole stack against a simulated amp
npm run build    # typecheck, then build into dist/
```

## How the code is arranged

```
src/protocol/    the wire format. pure: no DOM, no Bluetooth, no async
src/transport/   Web Bluetooth, the simulated amp, session recording, the write queue
src/state/       one source of truth for what the amp is doing
src/ui/          React components
spike/           the original prototype, kept as a reference
```

`src/protocol/` holds all the risk, so it holds all the care. It takes bytes and
returns objects, which is what lets 130 tests run with the amp switched off.
Every read is bounded, because a length byte taken from the wire and trusted is
how you walk off the end of a buffer, and a malformed message can wedge the amp
until you power-cycle it.

Read `docs/protocol.md` for the wire format, and `docs/open-questions.md` for
what this project still does not know.

## What the tests do not prove

The suite currently drives this project's own encoder against its own decoder.
That proves the two halves agree with each other. It proves nothing about
whether either half agrees with the amp, and a wrong belief about the protocol
produces a test that passes.

Only bytes captured from hardware close that gap. Connect to a real amp, switch
on **Raw hex**, use the amp, then select **Save capture**. Each capture belongs
in `test/fixtures/`. See `docs/open-questions.md` for the six questions the first
captures answer.

## Credit

The community did the hard work years ago. This project is a client, not a
reverse-engineering effort.

- [paulhamsh/Spark](https://github.com/paulhamsh/Spark) — message format notes
  and an ESP32 implementation
- [paulhamsh/Spark-Parser](https://github.com/paulhamsh/Spark-Parser) — the
  clearest reading of how messages are built
- [soundshed/soundshed-app](https://github.com/soundshed/soundshed-app) — the
  closest reference implementation, and the source of most of `docs/protocol.md`
- [richtamblyn/PGSparkLite](https://github.com/richtamblyn/PGSparkLite) — a
  Python client
- [kraps](https://git.sr.ht/~ianloic/kraps) — a firmware teardown, for background

## Licence

MIT. See `LICENSE`.
