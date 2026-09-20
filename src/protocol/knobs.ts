/**
 * What each knob does, per effect.
 *
 * ## Where this comes from, and how far to trust it
 *
 * The amp's own five knobs are documented everywhere and are not in doubt. No
 * primary source names the parameters of any other effect: paulhamsh's repos,
 * which are the best reference for the wire format, cover framing and command
 * numbers only.
 *
 * So these labels come from two independent client implementations:
 *
 *  - **S** — soundshed-app, `src/spork/src/devices/spark/sparkFxCatalog.ts`
 *  - **P** — PGSparkLite, `config/effects/<category>/*.json`
 *
 * Both were read directly. Every entry below is marked with the sources that
 * agree on it. Entries marked `S` or `P` alone rest on one implementation.
 *
 * What raises this above repeating hearsay is that it was checked against
 * hardware. The parameter *counts* in `test/fixtures/` — captured from a Spark
 * 40, serial S040CD381342 — match these tables: Booster has one parameter,
 * Compressor and Phaser and Cloner two, Flanger and the noise gate three,
 * ChorusAnalog four, DelayMono and every amp five, and reverb eight. Two
 * independent catalogues agreeing with each other is worth something; both of
 * them agreeing with the amp on the bench is worth considerably more.
 *
 * It does not make the *names* certain. A count can match while a label is
 * wrong, and no capture can tell you that a knob is called "Sensitivity".
 *
 * ## Gaps are left as gaps
 *
 * `null` means no source names that parameter, and the interface shows `P4` or
 * whatever the index is. PGSparkLite hides several of these in its own
 * interface, so they exist and are simply unnamed. Filling them by inference
 * would be inventing protocol documentation, which is how this project already
 * got one thing wrong.
 */

/** Which implementations name a given effect's parameters. */
export type LabelSource = 'S+P' | 'S' | 'P'

export interface KnobSet {
  labels: readonly (string | null)[]
  source: LabelSource
  /** Set where the two sources disagree, quoting the alternative. */
  note?: string
}

export const KNOBS: Record<string, KnobSet> = {
  /* ── gate ───────────────────────────────────────────────────────────────── */
  'bias.noisegate': { labels: ['Threshold', 'Decay', null], source: 'S+P' },

  /* ── compressors ────────────────────────────────────────────────────────── */
  LA2AComp: { labels: ['Limit', 'Gain', 'Peak Reduction'], source: 'S+P' },
  BlueComp: { labels: ['Level', 'Tone', 'Attack', 'Sustain'], source: 'S+P' },
  Compressor: { labels: ['Output', 'Sensitivity'], source: 'S+P' },
  BassComp: { labels: ['Comp', 'Gain', null], source: 'S+P' },
  BBEOpticalComp: { labels: ['Volume', 'Comp', 'Pad', null], source: 'S+P' },

  /* ── drives ─────────────────────────────────────────────────────────────── */
  Booster: { labels: ['Gain'], source: 'S+P' },
  DistortionTS9: { labels: ['Overdrive', 'Tone', 'Level'], source: 'S+P' },
  Overdrive: { labels: ['Level', 'Tone', 'Drive'], source: 'S+P' },
  Fuzz: { labels: ['Volume', 'Fuzz'], source: 'S+P' },
  ProCoRat: { labels: ['Distortion', 'Filter', 'Volume'], source: 'S+P' },
  BassBigMuff: { labels: ['Volume', 'Tone', 'Sustain'], source: 'S+P' },
  GuitarMuff: { labels: ['Volume', 'Tone', 'Sustain'], source: 'S+P' },
  MaestroBassmaster: { labels: ['Brass Vol', 'Sensitivity', 'Bass Vol'], source: 'S+P' },
  SABdriver: {
    labels: ['Volume', 'Tone', 'Drive', 'HP/LP'],
    source: 'S',
    note: 'PGSparkLite has the fourth parameter but does not name it',
  },
  KlonCentaurSilver: { labels: ['Output', 'Treble', 'Gain'], source: 'S+P' },
  MetalZoneMT2: {
    labels: ['Level', 'EQ Low', 'EQ Middle', 'EQ High', 'EQ Mid Band', 'Distortion'],
    source: 'S',
  },
  // soundshed lists P1/P2/P3 for this, which are placeholders rather than names.
  TrebleBooster: { labels: [null, null, null], source: 'S' },

  /* ── modulation ─────────────────────────────────────────────────────────── */
  Tremolo: { labels: ['Speed', 'Depth', 'Level'], source: 'S+P' },
  ChorusAnalog: { labels: ['E.Level', 'Rate', 'Depth', 'Tone'], source: 'S+P' },
  Flanger: { labels: ['Rate', 'Mix', 'Depth'], source: 'S+P' },
  Phaser: { labels: ['Speed', 'Intensity'], source: 'S+P' },
  Vibrato01: { labels: ['Speed', 'Depth'], source: 'S+P' },
  UniVibe: { labels: ['Speed', 'Chorus/Vibrato', 'Intensity'], source: 'S+P' },
  Cloner: { labels: ['Rate', 'Depth'], source: 'S+P' },
  MiniVibe: { labels: ['Speed', 'Intensity'], source: 'S+P' },
  Tremolator: { labels: ['Depth', 'Speed', 'BPM', null], source: 'S+P' },
  TremoloSquare: { labels: ['Speed', 'Depth', 'Level', null], source: 'S+P' },
  MuTron: { labels: ['Mode', 'Peak', 'Depth', 'Range', 'Position'], source: 'S' },
  GuitarEQ6: { labels: ['Level', '100', '200', '400', '800', '1.6K', '3.2K'], source: 'S+P' },
  BassEQ6: { labels: ['Level', '100', '200', '400', '800', '1.6K', '3.2K'], source: 'P' },

  /* ── delays ─────────────────────────────────────────────────────────────── */
  DelayMono: { labels: ['E.Level', 'F.Back', 'D.Time', 'Mode', 'BPM'], source: 'S+P' },
  DelayEchoFilt: { labels: ['Delay', 'Feedback', 'Level', 'Tone', 'BPM'], source: 'S+P' },
  VintageDelay: { labels: ['Repeat Rate', 'Intensity', 'Echo', 'BPM'], source: 'S+P' },
  DelayReverse: { labels: ['Mix', 'Decay', 'Filter', 'Time', 'BPM'], source: 'S+P' },
  DelayMultiHead: { labels: ['Repeat Rate', 'Intensity', 'Echo Vol', 'Mode', 'BPM'], source: 'S+P' },
  DelayRe201: { labels: ['Sustain', 'Volume', 'Tone', 'Short to Long', 'BPM'], source: 'S+P' },

  /* ── reverb ─────────────────────────────────────────────────────────────── */
  'bias.reverb': {
    labels: ['Level', 'Damping', 'Low Cut', 'High Cut', 'Dwell', 'Time', 'Type', 'On'],
    source: 'S+P',
  },
}

/** The amp slot's five, which every source and every amp model agrees on. */
export const AMP_KNOBS = ['Gain', 'Treble', 'Mid', 'Bass', 'Master'] as const

/**
 * Reverb rooms, selected by the float in parameter index 6.
 *
 * Two implementations arrive at the same nine values independently: soundshed
 * switches on the float rounded to two decimals, and PGSparkLite builds the
 * float from its JSON key as `0.<n>`. The values are not in doubt.
 *
 * Three of the *names* are. Where the two disagree the alternative is in
 * `alternative`, and neither has been checked against the official app, so
 * neither is presented as settled.
 *
 * There is no spring reverb, despite the protocol notes saying "hall, plate,
 * spring, etc." — that phrase is prose, not a list of what the amp has.
 */
export interface ReverbRoom {
  value: number
  name: string
  alternative?: string
}

export const REVERB_ROOMS: readonly ReverbRoom[] = [
  { value: 0.0, name: 'Room Studio A' },
  { value: 0.1, name: 'Room Studio B' },
  { value: 0.2, name: 'Chamber' },
  { value: 0.3, name: 'Hall Natural' },
  { value: 0.4, name: 'Hall Medium', alternative: 'Holy Grail' },
  { value: 0.5, name: 'Hall Ambient' },
  { value: 0.6, name: 'Plate Short' },
  { value: 0.7, name: 'Plate Rich', alternative: 'Classic Plate' },
  { value: 0.8, name: 'Plate Long', alternative: 'Reflection' },
]

/** The index of the reverb's room selector. */
export const REVERB_TYPE_INDEX = 6

/** The room nearest a float, or null if it is not close to any of them. */
export function reverbRoomFor(value: number): ReverbRoom | null {
  let best: ReverbRoom | null = null
  let distance = Infinity
  for (const room of REVERB_ROOMS) {
    const d = Math.abs(room.value - value)
    if (d < distance) {
      distance = d
      best = room
    }
  }
  return distance <= 0.05 ? best : null
}

/**
 * The label for one knob, or null when nothing names it.
 *
 * `isAmp` matters because every amp model shares one set of five names, and
 * there are more than fifty models.
 */
export function knobLabelFor(dsp: string, index: number, isAmp: boolean): string | null {
  if (isAmp) return AMP_KNOBS[index] ?? null
  return KNOBS[dsp]?.labels[index] ?? null
}

/** Where a given effect's labels come from, for showing in the interface. */
export function labelSourceFor(dsp: string): KnobSet | null {
  return KNOBS[dsp] ?? null
}
