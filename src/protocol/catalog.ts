/**
 * What can go in each slot, and what it is called.
 *
 * The signal chain is seven slots in a fixed order. You swap what sits in a
 * slot; you never reorder them. The amp slot is special in a way that matters on
 * the wire: parameter changes and model swaps there use command `03`, while
 * every other slot uses command `01`. Getting that wrong produces a command the
 * amp quietly ignores.
 *
 * Names on the left of each map are DSP names — what actually goes on the wire.
 * Names on the right are what the official app shows. Where the two agree, the
 * entry is still listed, because "no display name" and "same display name" are
 * different things and only one of them should mean the catalogue is incomplete.
 */

import { knobLabelFor } from './knobs.js'

export type SlotKind = 'Gate' | 'Comp' | 'Drive' | 'Amp' | 'Mod' | 'Delay' | 'Reverb'

export interface SlotSpec {
  index: number
  kind: SlotKind
  /** Command byte for parameter changes and model swaps in this slot. */
  cmd: number
  /** Sub-command for a parameter change in this slot. */
  paramSub: number
  /** Sub-command for a model swap in this slot. */
  swapSub: number
}

export const SLOT_COUNT = 7
export const AMP_SLOT = 3

export const SLOTS: readonly SlotSpec[] = [
  { index: 0, kind: 'Gate', cmd: 0x01, paramSub: 0x04, swapSub: 0x06 },
  { index: 1, kind: 'Comp', cmd: 0x01, paramSub: 0x04, swapSub: 0x06 },
  { index: 2, kind: 'Drive', cmd: 0x01, paramSub: 0x04, swapSub: 0x06 },
  { index: 3, kind: 'Amp', cmd: 0x03, paramSub: 0x37, swapSub: 0x06 },
  { index: 4, kind: 'Mod', cmd: 0x01, paramSub: 0x04, swapSub: 0x06 },
  { index: 5, kind: 'Delay', cmd: 0x01, paramSub: 0x04, swapSub: 0x06 },
  { index: 6, kind: 'Reverb', cmd: 0x01, paramSub: 0x04, swapSub: 0x06 },
]

export function slotSpec(index: number): SlotSpec {
  const spec = SLOTS[index]
  if (!spec) throw new RangeError(`no slot ${index}; the chain has ${SLOT_COUNT}`)
  return spec
}

const GATE: Record<string, string> = {
  'bias.noisegate': 'Noise Gate',
}

const COMP: Record<string, string> = {
  LA2AComp: 'LA Comp',
  BlueComp: 'Sustain Comp',
  Compressor: 'Red Comp',
  BassComp: 'Bass Comp',
  BBEOpticalComp: 'Optical Comp',
}

const DRIVE: Record<string, string> = {
  Booster: 'Booster',
  DistortionTS9: 'Tube Drive',
  Overdrive: 'Over Drive',
  Fuzz: 'Fuzz Face',
  ProCoRat: 'Black Op',
  MetalZoneMT2: 'Metal Zone',
  BassBigMuff: 'Bass Muff',
  GuitarMuff: 'Guitar Muff',
  MaestroBassmaster: 'Bassmaster',
  SABdriver: 'SAB Driver',
  TrebleBooster: 'Treble Booster',
  Sansamp: 'Sansamp',
}

const AMP: Record<string, string> = {
  RolandJC120: 'Silver 120',
  Twin: 'Black Duo',
  ADClean: 'AD Clean',
  '94MatchDCV2': 'Match DC',
  Bassman: 'Tweed Bass',
  // The space in this key is not a typo — it is what goes on the wire.
  'AC Boost': 'AC Boost',
  Checkmate: 'Checkmate',
  TwoStoneSP50: 'Two Stone SP50',
  Deluxe65: 'American Deluxe',
  Plexi: 'Plexiglass',
  OverDrivenJM45: 'JM45',
  OverDrivenLuxVerb: 'Lux Verb',
  Bogner: 'RB 101',
  OrangeAD30: 'British 30',
  AmericanHighGain: 'American High Gain',
  SLO100: 'SLO 100',
  YJM100: 'YJM100',
  Rectifier: 'Treadplate',
  EVH: 'Insane',
  SwitchAxeLead: 'Switch Axe',
  Invader: 'Rocker V',
  BE101: 'BE 101',
  JCM800: 'JCM800',
  Deluxe57: "'57 Deluxe",
  JCM900: 'JCM900',
  MatchlessDC30: 'Matchless DC30',
  DrZ: 'Dr Z',
  ENGL: 'ENGL',
  Acoustic: 'Pure Acoustic',
  AcousticAmpV2: 'Fishboy',
  FatAcousticV2: 'Jumbo',
  FlatAcoustic: 'Flat Acoustic',
  GK800: 'RB-800',
  Sunny3000: 'Sunny 3000',
  W600: 'W600',
  Hammer500: 'Hammer 500',
}

/** Bass models. Same slot, listed apart so the picker can group them. */
const BASS_AMP: Record<string, string> = {
  SVT: 'SVT',
  PowerAmp: 'Power Amp',
  LaneyDH50: 'Laney DH50',
  Hiwatt103: 'Hiwatt 103',
  RedHead: 'Red Head',
  B15: 'B15',
  Acoustic360: 'Acoustic 360',
  GK700RBII: 'GK700 RB II',
  OrangeAD200: 'Orange AD200',
  SuperBassman: 'Super Bassman',
  AcousticPro: 'Acoustic Pro',
  AcousticImg: 'Acoustic Img',
  RB101B1: 'RB101 B1',
}

const MOD: Record<string, string> = {
  Tremolo: 'Tremolo',
  ChorusAnalog: 'Chorus',
  Flanger: 'Flanger',
  Phaser: 'Phaser',
  Vibrato01: 'Vibrato',
  UniVibe: 'UniVibe',
  Cloner: 'Cloner Chorus',
  MiniVibe: 'Classic Vibe',
  Tremolator: 'Tremolator',
  TremoloSquare: 'Tremolo Square',
}

const DELAY: Record<string, string> = {
  DelayMono: 'Digital Delay',
  DelayEchoFilt: 'Echo Filt',
  VintageDelay: 'Vintage Delay',
  DelayReverse: 'Reverse Delay',
  DelayMultiHead: 'Multi Head',
  DelayRe201: 'Echo Tape',
}

const REVERB: Record<string, string> = {
  'bias.reverb': 'Reverb',
}

/** DSP name → display name, indexed by slot. */
export const CATALOG: readonly Record<string, string>[] = [
  GATE,
  COMP,
  DRIVE,
  { ...AMP, ...BASS_AMP },
  MOD,
  DELAY,
  REVERB,
]

export const GUITAR_AMPS = AMP
export const BASS_AMPS = BASS_AMP

/** Display name for a DSP name, falling back to the DSP name itself. */
export function displayName(slot: number, dsp: string): string {
  return CATALOG[slot]?.[dsp] ?? dsp
}

/** Whether this DSP name is one we know belongs in this slot. */
export function isKnownModel(slot: number, dsp: string): boolean {
  return Boolean(CATALOG[slot] && dsp in (CATALOG[slot] as Record<string, string>))
}

/**
 * The label for one knob, falling back to its index when nothing names it.
 *
 * The labels themselves live in `knobs.ts`, along with an account of where each
 * one comes from and how far to trust it.
 */
export function knobLabel(slot: number, dsp: string, index: number): string {
  return knobLabelFor(dsp, index, slot === AMP_SLOT) ?? `P${index + 1}`
}

/** Whether a source actually names this knob, as opposed to us showing its index. */
export function knobIsNamed(slot: number, dsp: string, index: number): boolean {
  return knobLabelFor(dsp, index, slot === AMP_SLOT) !== null
}

/** Hardware preset slots on the amp's front panel. */
export const HARDWARE_PRESETS = 4
/** Channel byte meaning "the live sound", as opposed to a stored slot. */
export const LIVE_CHANNEL = 0x7f
