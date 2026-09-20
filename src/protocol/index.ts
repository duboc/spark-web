/**
 * The protocol layer.
 *
 * Pure: no DOM, no Bluetooth, no timers, no async. Bytes in, objects out. That
 * is what lets the whole wire format be tested with the amp switched off, and
 * the wire format is where all the risk in this project lives.
 */

export * from './codec.js'
export * from './frame.js'
export * from './catalog.js'
export * from './preset.js'
export * from './messages.js'
export * from './knobs.js'
export * from './commands.js'
