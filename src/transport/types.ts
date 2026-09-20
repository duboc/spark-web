/**
 * The seam between the protocol and the radio.
 *
 * Everything above this interface deals in bytes and never knows whether they
 * came from a Spark, a recorded session or a test. That is what lets the whole
 * application run with no amp in the room.
 */

export interface TransportInfo {
  /** Whatever the device calls itself. */
  name: string
}

export interface TransportListener {
  /** Bytes arrived. Not a message, not even a block — just bytes. */
  data?(bytes: Uint8Array): void
  /** The link dropped, expectedly or otherwise. */
  disconnected?(reason?: string): void
}

export interface Transport {
  /** Shown in the UI, so you can tell a live amp from a replay at a glance. */
  readonly label: string
  readonly connected: boolean

  connect(): Promise<TransportInfo>
  disconnect(): Promise<void>

  /** Write one whole block. */
  write(block: Uint8Array): Promise<void>

  /** Returns a function that removes the listener. */
  listen(listener: TransportListener): () => void
}

/** Shared listener bookkeeping, so each transport does not reimplement it. */
export class Listeners {
  readonly #listeners = new Set<TransportListener>()

  add(listener: TransportListener): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  clear(): void {
    this.#listeners.clear()
  }

  data(bytes: Uint8Array): void {
    for (const l of this.#listeners) l.data?.(bytes)
  }

  disconnected(reason?: string): void {
    for (const l of this.#listeners) l.disconnected?.(reason)
  }
}
