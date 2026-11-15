import { ButtonLink, type ButtonLinkCallbacks } from './buttonLink'

/** Nordic UART Service, as advertised by firmware/table_button_esp32. */
export const NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
/** The host writes lines here. */
export const NUS_RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'
/** The board notifies lines here. */
export const NUS_TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'
/** Boards advertise as "Ding-XXXX". */
export const DEVICE_NAME_PREFIX = 'Ding'
/** Payload that always fits one write with the default ATT MTU (23 - 3). */
export const WRITE_CHUNK = 20

export const RECONNECT_BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 15_000]

// ---- minimal Web Bluetooth typings (not in the TS DOM lib; no @types package on purpose)

export interface BtCharacteristic extends EventTarget {
  readonly value: DataView | null
  readonly properties?: { write?: boolean; writeWithoutResponse?: boolean }
  startNotifications(): Promise<BtCharacteristic>
  writeValueWithResponse?(value: Uint8Array): Promise<void>
  writeValueWithoutResponse?(value: Uint8Array): Promise<void>
  writeValue?(value: Uint8Array): Promise<void>
}
export interface BtService {
  getCharacteristic(uuid: string): Promise<BtCharacteristic>
}
export interface BtServer {
  readonly connected: boolean
  connect(): Promise<BtServer>
  disconnect(): void
  getPrimaryService(uuid: string): Promise<BtService>
}
export interface BtDevice extends EventTarget {
  readonly id: string
  readonly name?: string
  readonly gatt?: BtServer
  watchAdvertisements?(options?: { signal?: AbortSignal }): Promise<void>
}
export interface BtApi {
  requestDevice(options: {
    filters: ({ services: string[] } | { namePrefix: string })[]
    optionalServices?: string[]
  }): Promise<BtDevice>
  /** Devices this site was already allowed to use. Missing in some browsers / behind a flag. */
  getDevices?(): Promise<BtDevice[]>
}

function bluetoothApi(): BtApi | null {
  if (typeof navigator === 'undefined') return null
  return (navigator as Navigator & { bluetooth?: BtApi }).bluetooth ?? null
}

export interface BluetoothButtonOptions {
  /** Injected in tests; defaults to navigator.bluetooth. */
  bluetooth?: BtApi | null
  backoffMs?: number[]
}

/**
 * The table button over Bluetooth LE (Web Bluetooth, Nordic UART Service).
 * Once a device is chosen, a dropped link (battery box moved away, board reset)
 * is re-established automatically with backoff; no new click is needed.
 */
export class BluetoothButton extends ButtonLink {
  readonly transport = 'bluetooth' as const
  private api: BtApi | null
  private backoff: number[]
  private device: BtDevice | null = null
  private rx: BtCharacteristic | null = null
  private tx: BtCharacteristic | null = null
  /** The user wants this device; keep reconnecting until disconnect(). */
  private wanted = false
  private attempt = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private opening: Promise<void> | null = null
  private watching: AbortController | null = null

  constructor(callbacks: ButtonLinkCallbacks, options: BluetoothButtonOptions = {}) {
    super(callbacks)
    this.api = options.bluetooth === undefined ? bluetoothApi() : options.bluetooth
    this.backoff = options.backoffMs ?? RECONNECT_BACKOFF_MS
  }

  static isSupported(api: BtApi | null = bluetoothApi()): boolean {
    return api !== null
  }

  get deviceName(): string | null {
    return this.device?.name ?? null
  }

  async connect(): Promise<void> {
    if (!this.api) throw new Error('This browser has no Web Bluetooth. Use Chrome or Edge on a laptop.')
    const device = await this.api.requestDevice({
      filters: [{ services: [NUS_SERVICE] }, { namePrefix: DEVICE_NAME_PREFIX }],
      optionalServices: [NUS_SERVICE],
    })
    await this.use(device)
  }

  /**
   * After a page reload: pick up a device granted earlier, without a prompt. Returns
   * true when such a device exists; it is then connected, or being reconnected in the
   * background if it is out of range right now.
   */
  async reconnectKnown(): Promise<boolean> {
    if (!this.api?.getDevices) return false // not available in this browser: needs a click
    let devices: BtDevice[]
    try {
      devices = await this.api.getDevices()
    } catch {
      return false
    }
    const device = devices.find((d) => d.name?.startsWith(DEVICE_NAME_PREFIX)) ?? devices[0]
    if (!device) return false
    await this.use(device, true)
    return true
  }

  /** Take over `device`. A failed first connect is thrown to the caller, unless `keepTrying`. */
  private async use(device: BtDevice, keepTrying = false) {
    await this.disconnect()
    this.device = device
    this.wanted = true
    this.attempt = 0
    device.addEventListener('gattserverdisconnected', this.onDrop)
    this.setStatus('connecting')
    try {
      await this.open()
    } catch (err) {
      if (keepTrying) {
        this.setStatus('reconnecting')
        this.startWatching()
        this.scheduleRetry()
        return
      }
      this.forget()
      this.device = null
      this.setStatus('disconnected')
      throw err
    }
  }

  /** Chrome connects to a remembered device more reliably once it has seen it advertise. */
  private startWatching() {
    const device = this.device
    if (!device?.watchAdvertisements || this.watching) return
    const controller = new AbortController()
    this.watching = controller
    device.addEventListener('advertisementreceived', this.onAdvertisement)
    device.watchAdvertisements({ signal: controller.signal }).catch(() => this.stopWatching())
  }

  private stopWatching() {
    this.watching?.abort()
    this.watching = null
    this.device?.removeEventListener('advertisementreceived', this.onAdvertisement)
  }

  private onAdvertisement = () => {
    if (this.status !== 'reconnecting' || !this.wanted) return
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.open().catch(() => {
      if (this.wanted && this.status !== 'connected') this.scheduleRetry()
    })
  }

  private open(): Promise<void> {
    if (!this.opening) {
      this.opening = this.openOnce().finally(() => {
        this.opening = null
      })
    }
    return this.opening
  }

  private async openOnce() {
    const device = this.device
    const gatt = device?.gatt
    if (!device || !gatt) throw new Error('This Bluetooth device cannot be connected.')
    const server = await gatt.connect()
    const service = await server.getPrimaryService(NUS_SERVICE)
    const [rx, tx] = await Promise.all([service.getCharacteristic(NUS_RX), service.getCharacteristic(NUS_TX)])
    if (this.device !== device) return // disconnected meanwhile
    tx.addEventListener('characteristicvaluechanged', this.onNotify)
    await tx.startNotifications()
    this.rx = rx
    this.tx = tx
    this.attempt = 0
    this.stopWatching()
    await this.markConnected()
  }

  private onNotify = (event: Event) => {
    const value = (event.target as BtCharacteristic | null)?.value
    if (value) this.receive(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
  }

  private onDrop = () => {
    this.tx?.removeEventListener('characteristicvaluechanged', this.onNotify)
    this.rx = this.tx = null
    if (!this.wanted || !this.device) {
      this.setStatus('disconnected')
      return
    }
    this.setStatus('reconnecting')
    this.startWatching()
    this.scheduleRetry()
  }

  private scheduleRetry() {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    const delay = this.backoff[Math.min(this.attempt, this.backoff.length - 1)]
    this.attempt++
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      if (!this.wanted || !this.device) return
      this.open().catch(() => {
        if (this.wanted && this.status !== 'connected') this.scheduleRetry()
      })
    }, delay)
  }

  protected async writeRaw(bytes: Uint8Array): Promise<void> {
    for (let i = 0; i < bytes.length; i += WRITE_CHUNK) {
      const rx = this.rx
      if (!rx) return
      const part = bytes.slice(i, i + WRITE_CHUNK)
      // With-response writes are acknowledged one by one, so chunks arrive in order.
      if (rx.writeValueWithResponse && rx.properties?.write !== false) await rx.writeValueWithResponse(part)
      else if (rx.writeValueWithoutResponse) await rx.writeValueWithoutResponse(part)
      else if (rx.writeValue) await rx.writeValue(part)
    }
  }

  private forget() {
    this.wanted = false
    this.stopWatching()
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.device?.removeEventListener('gattserverdisconnected', this.onDrop)
    this.tx?.removeEventListener('characteristicvaluechanged', this.onNotify)
    this.rx = this.tx = null
  }

  async disconnect(): Promise<void> {
    const device = this.device
    this.forget()
    this.device = null
    try {
      if (device?.gatt?.connected) device.gatt.disconnect()
    } catch {
      /* ignore */
    }
    this.setStatus('disconnected')
  }
}
