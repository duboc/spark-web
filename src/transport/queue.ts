/**
 * One queue, one writer.
 *
 * Every command goes out through here, in order, with a gap after it. Nothing
 * calls the transport's write directly from an event handler — a slider drag
 * fires far faster than the amp can keep up, and a burst of concurrent writes is
 * the quickest way to make a working setup look like a broken parser.
 *
 * The gap comes from the command, and {@link QueueOptions.gapScale} multiplies
 * all of them at once. If the amp starts misbehaving, raise the scale before
 * suspecting anything else: community guidance is 500 ms between commands, the
 * values here are roughly a tenth of that, and where the real floor sits has not
 * been established by bisection yet.
 */

import type { Command } from '../protocol/commands.js'
import type { Transport } from './types.js'

export interface QueueOptions {
  /** Multiplies every gap. 1 is the tuned default; raise it if the amp gets flaky. */
  gapScale?: number
  /** Gap between the blocks of one multi-block command. */
  interBlockGapMs?: number
  onSent?(command: Command): void
  onError?(command: Command, error: unknown): void
}

export class WriteQueue {
  readonly #transport: Transport
  readonly #options: Required<Omit<QueueOptions, 'onSent' | 'onError'>> &
    Pick<QueueOptions, 'onSent' | 'onError'>

  #pending: Command[] = []
  #draining = false

  constructor(transport: Transport, options: QueueOptions = {}) {
    this.#transport = transport
    this.#options = {
      gapScale: options.gapScale ?? 1,
      interBlockGapMs: options.interBlockGapMs ?? 40,
      ...(options.onSent ? { onSent: options.onSent } : {}),
      ...(options.onError ? { onError: options.onError } : {}),
    }
  }

  get depth(): number {
    return this.#pending.length
  }

  send(...commands: Command[]): void {
    this.#pending.push(...commands)
    void this.#drain()
  }

  /**
   * Drop everything not yet written.
   *
   * Used when a slider is dragged: the queued positions it passed through are
   * worth less than the one it is at now, and sending them all makes the amp
   * chase the pointer several seconds behind.
   */
  clear(): void {
    this.#pending = []
  }

  /** Drop queued commands matching a predicate — a drag supersedes its own earlier ticks. */
  drop(match: (command: Command) => boolean): void {
    this.#pending = this.#pending.filter((c) => !match(c))
  }

  /** Resolves once the queue has run dry. Tests want this; the interface does not. */
  async idle(): Promise<void> {
    while (this.#draining || this.#pending.length > 0) {
      await delay(this.#options.interBlockGapMs)
    }
  }

  async #drain(): Promise<void> {
    if (this.#draining) return
    this.#draining = true

    try {
      while (this.#pending.length > 0) {
        const command = this.#pending.shift() as Command
        try {
          for (const [i, block] of command.blocks.entries()) {
            if (i > 0) await delay(this.#options.interBlockGapMs * this.#options.gapScale)
            await this.#transport.write(block)
          }
          this.#options.onSent?.(command)
        } catch (error) {
          this.#options.onError?.(command, error)
        }
        await delay(command.gapMs * this.#options.gapScale)
      }
    } finally {
      this.#draining = false
    }
  }
}

function delay(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve()
}
