# The spike

`spark-web.html` is the original prototype: one file, no build step, no
dependencies. It is kept because it is the only code here that a real Spark 40
has ever answered.

## Do not build on this

The application in `src/` replaces it. The spike stays for two reasons:

- It is a fallback. If the new application fails to connect, open the spike. If
  the spike connects and the application does not, the fault is in the new
  transport rather than in your amp or your Bluetooth setup. That is a useful
  thing to be able to separate.
- It is the reference for behaviour that hardware confirmed. Where the spike and
  `src/protocol/` disagree, the spike is the one that has met an amp.

## Run it

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000/spike/spark-web.html`. Web Bluetooth needs a
secure context, so `localhost` or `https` works and opening the file directly
does not.

## What it does not do

The spike has no preset upload, no preset files, and no tests. Its receive path
guesses: for messages that are not presets, it decodes the payload twice, at two
different alignments, and keeps whichever attempt parses. `src/protocol/frame.ts`
replaces that guess with a check, but the guess is still what ran against
hardware, so keep it in mind when the two disagree.
