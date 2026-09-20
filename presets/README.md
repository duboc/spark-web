# Presets

Four starting points, as files you can read, diff and change.

Load one with **Load from file**, or drag it onto the page. That puts it on the
amp as the live sound and overwrites nothing. When you like it, use **Store to
slot…** to commit it to hardware.

## What is here

| File | Amp model | In the style of |
| --- | --- | --- |
| `boutique-clean.spark.json` | Two Stone SP50 | John Mayer |
| `indie-crunch.spark.json` | AC Boost | Arctic Monkeys |
| `stack-lead.spark.json` | JCM800 | Guns N' Roses |
| `scooped-metal.spark.json` | Treadplate | Metallica |

### Boutique clean

A Two-Rock-style amp is the closest thing the Spark has to the boutique cleans
that sound belongs to, so the gain sits at 3.5 and the master carries the volume.
That is the whole trick: the amp stays clean and loud rather than quiet and
polite, which is what gives the notes their bloom.

The compressor is light. Heavy compression flattens the dynamics that make this
style work. Chorus is dialled in but switched off, so you can reach for it
without setting it up first. The delay is ambience rather than an effect you
hear as repeats.

### Indie crunch

An AC30 is bright and breaks up early, and a Tube Screamer in front adds bite
without turning it into a distortion pedal — the drive sits at 3.5 while the
level sits at 5.5, which pushes the amp rather than the signal. Bass is pulled
back to 4.0 to keep it from turning woolly.

The delay is a short slapback, the kind you notice only when it stops.

### Stack lead

A JCM800 with a clean boost in front, mids forward at 6.5. Marshall mids are
what carry this tone; scooping them is the usual mistake. The gain is at 7.0
rather than higher, because the boost is doing part of the work and a bridge
humbucker does the rest.

The gate is on, because this much gain in front of a stack is noisy.

### Scooped metal

Mids at 2.0. That scoop is the sound, and it is also why it disappears in a
band mix — if you play this with other people, bring the mids back up to about
4.0 and you will hear yourself again.

The Tube Screamer is set as a tightener, not a drive: overdrive at 0.5, level at
6.5. That is the standard trick for a high-gain amp, and it cleans up the low end
so palm mutes stay defined. The gate shuts hard, with decay at zero.

## What these are not

They are informed starting points, not reproductions. Every one of these players
sounds the way they do because of their hands, their guitar, their pickups and a
room, and a modelling amp reaches none of that.

They have also never been heard. They are built from what the models are
modelled on and from where each style puts its gain and its mids. Your guitar
will want different numbers, and the honest way to use these is as a place to
start turning knobs.

## What is guaranteed

`test/presets.test.ts` checks every file on each run:

- it validates, so it cannot wedge the amp
- every model exists in the catalogue for its slot
- it round-trips through the wire format without losing anything
- it fits in blocks the amp accepts
- every effect uses a parameter count a real Spark 40 has actually produced,
  taken from the capture in `test/fixtures/` rather than from documentation

That last check is the useful one. Parameter counts vary by effect and, on this
firmware, even between presets for the same effect — a Tube Screamer appears
with three parameters in one stored preset and four in another. These files use
only shapes the hardware has been seen to produce.
