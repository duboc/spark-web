/**
 * Web Bluetooth transport.
 *
 * The amp presents two separate Bluetooth links. `Spark 40 Audio` is Bluetooth
 * Classic and carries music; you pair it in your operating system's settings.
 * `Spark 40 BLE` is the control link and is the one this connects to. It must
 * *not* be paired in the operating system — you select it in the browser's
 * device chooser instead. Pairing it in the OS is the most common reason the
 * chooser comes up empty or the connection fails.
 *
 * Web Bluetooth needs a secure context, so this works on `https://` or
 * `http://localhost` and nowhere else. It is available in Chrome and Edge, on
 * desktop and on Android. Safari, Firefox and every browser on iOS do not
 * implement it and never silently degrade — they simply have no
 * `navigator.bluetooth`.
 */

import { Listeners, type Transport, type TransportInfo, type TransportListener } from './types.js'

export const SPARK_SERVICE = '0000ffc0-0000-1000-8000-00805f9b34fb'
export const SPARK_WRITE = '0000ffc1-0000-1000-8000-00805f9b34fb'
export const SPARK_NOTIFY = '0000ffc2-0000-1000-8000-00805f9b34fb'

export function bluetoothAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator
}

export class BleTransport implements Transport {
  readonly label = 'Bluetooth'

  #device: BluetoothDevice | null = null
  #write: BluetoothRemoteGATTCharacteristic | null = null
  #notify: BluetoothRemoteGATTCharacteristic | null = null
  readonly #listeners = new Listeners()

  get connected(): boolean {
    return this.#device?.gatt?.connected === true && this.#write !== null
  }

  async connect(): Promise<TransportInfo> {
    if (!bluetoothAvailable()) {
      throw new Error(
        'This browser has no Web Bluetooth. Use Chrome or Edge, over localhost or https.',
      )
    }

    // requestDevice needs a user gesture, which is why there is a Connect
    // button and no reconnect on page load.
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SPARK_SERVICE] }, { namePrefix: 'Spark' }],
      optionalServices: [SPARK_SERVICE],
    })

    device.addEventListener('gattserverdisconnected', this.#onDisconnected)

    const server = await device.gatt?.connect()
    if (!server) throw new Error('the device exposed no GATT server')

    const service = await server.getPrimaryService(SPARK_SERVICE)
    this.#write = await service.getCharacteristic(SPARK_WRITE)
    this.#notify = await service.getCharacteristic(SPARK_NOTIFY)

    this.#notify.addEventListener('characteristicvaluechanged', this.#onValue)
    await this.#notify.startNotifications()

    this.#device = device
    return { name: device.name ?? 'Spark' }
  }

  async disconnect(): Promise<void> {
    const device = this.#device
    this.#device = null
    this.#write = null

    if (this.#notify) {
      this.#notify.removeEventListener('characteristicvaluechanged', this.#onValue)
      try {
        await this.#notify.stopNotifications()
      } catch {
        // The link may already be gone; nothing here is worth reporting.
      }
      this.#notify = null
    }

    if (device) {
      device.removeEventListener('gattserverdisconnected', this.#onDisconnected)
      device.gatt?.disconnect()
    }
  }

  async write(block: Uint8Array): Promise<void> {
    const characteristic = this.#write
    if (!characteristic) throw new Error('not connected')

    // Copy into a buffer the DOM types accept. A block is at most 173 bytes, so
    // the copy costs nothing worth measuring.
    const bytes = new Uint8Array(block)

    // Writing without a response is faster and is what the amp expects, but
    // Chrome enforces its own queue depth on it and can reject a burst. Falling
    // back to an acknowledged write costs latency and keeps the block.
    if (characteristic.properties.writeWithoutResponse) {
      try {
        await characteristic.writeValueWithoutResponse(bytes)
        return
      } catch {
        // fall through
      }
    }
    await characteristic.writeValue(bytes)
  }

  listen(listener: TransportListener): () => void {
    return this.#listeners.add(listener)
  }

  readonly #onValue = (event: Event): void => {
    const target = event.target as BluetoothRemoteGATTCharacteristic
    const value = target.value
    if (!value) return
    this.#listeners.data(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
  }

  readonly #onDisconnected = (): void => {
    this.#write = null
    this.#notify = null
    this.#listeners.disconnected('the amp disconnected')
  }
}
