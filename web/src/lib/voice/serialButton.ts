import { ButtonLink, type ButtonLinkCallbacks } from './buttonLink'

// Minimal Web Serial typings (not in the TS DOM lib yet).
interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>
  close(): Promise<void>
  readonly readable: ReadableStream<Uint8Array> | null
  readonly writable: WritableStream<Uint8Array> | null
}
interface SerialLike extends EventTarget {
  requestPort(options?: object): Promise<SerialPortLike>
  getPorts(): Promise<SerialPortLike[]>
}

function serialApi(): SerialLike | null {
  return (navigator as Navigator & { serial?: SerialLike }).serial ?? null
}

export const BAUD_RATE = 115_200

/**
 * The table button on a USB cable, over Web Serial. Works with the ESP32 + LCD
 * firmware and with the legacy Uno sketch (which ignores INFO lines).
 */
export class SerialButton extends ButtonLink {
  readonly transport = 'usb' as const
  private port: SerialPortLike | null = null
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null

  constructor(callbacks: ButtonLinkCallbacks) {
    super(callbacks)
  }

  static isSupported(): boolean {
    return serialApi() !== null
  }

  async connect(): Promise<void> {
    const serial = serialApi()
    if (!serial) throw new Error('This browser has no Web Serial. Use Chrome or Edge on a laptop.')
    const port = await serial.requestPort()
    await this.open(port)
  }

  async reconnectKnown(): Promise<boolean> {
    const serial = serialApi()
    if (!serial) return false
    const [port] = await serial.getPorts()
    if (!port) return false
    try {
      await this.open(port)
      return true
    } catch {
      this.setStatus('disconnected')
      return false
    }
  }

  private async open(port: SerialPortLike) {
    await this.disconnect()
    this.setStatus('connecting')
    try {
      await port.open({ baudRate: BAUD_RATE })
    } catch (err) {
      this.setStatus('disconnected')
      throw err
    }
    this.port = port
    void this.markConnected()
    void this.readLoop(port)
  }

  private async readLoop(port: SerialPortLike) {
    try {
      while (port.readable && this.port === port) {
        const reader = port.readable.getReader()
        this.reader = reader
        try {
          for (;;) {
            const { value, done } = await reader.read()
            if (done) break
            if (value) this.receive(value)
          }
        } finally {
          reader.releaseLock()
          this.reader = null
        }
      }
    } catch {
      /* device lost (unplugged) or reader cancelled */
    }
    if (this.port === port) {
      this.port = null
      try {
        await port.close()
      } catch {
        /* already closed */
      }
      this.setStatus('disconnected')
    }
  }

  protected async writeRaw(bytes: Uint8Array): Promise<void> {
    const port = this.port
    if (!port?.writable) return
    const writer = port.writable.getWriter()
    try {
      await writer.write(bytes)
    } finally {
      writer.releaseLock()
    }
  }

  async disconnect(): Promise<void> {
    const port = this.port
    this.port = null
    if (!port) {
      this.setStatus('disconnected')
      return
    }
    try {
      await this.reader?.cancel()
    } catch {
      /* ignore */
    }
    try {
      await port.close()
    } catch {
      /* ignore */
    }
    this.setStatus('disconnected')
  }
}
