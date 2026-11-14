import type { ButtonState } from '@/api/types'
import { LineSplitter } from './lineSplitter'

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

export interface SerialButtonCallbacks {
  onPress: () => void
  onRelease: () => void
  /** The port closed or the cable was pulled. */
  onDisconnect?: () => void
}

/**
 * The physical table button over Web Serial (see docs/API.md, "Table button
 * serial protocol"): reads `PRESS` / `RELEASE` lines, writes `STATE:<state>`.
 */
export class SerialButton {
  private port: SerialPortLike | null = null
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private writeChain: Promise<void> = Promise.resolve()
  private callbacks: SerialButtonCallbacks
  private lastState: ButtonState | null = null

  constructor(callbacks: SerialButtonCallbacks) {
    this.callbacks = callbacks
  }

  static isSupported(): boolean {
    return serialApi() !== null
  }

  get connected(): boolean {
    return this.port !== null
  }

  /** Asks the user to pick a port. Must be called from a click handler. */
  async connect(): Promise<void> {
    const serial = serialApi()
    if (!serial) throw new Error('This browser has no Web Serial. Use Chrome or Edge on a laptop.')
    const port = await serial.requestPort()
    await this.open(port)
  }

  /** Re-opens a port the user already granted earlier, without a prompt. */
  async reconnectKnown(): Promise<boolean> {
    const serial = serialApi()
    if (!serial) return false
    const [port] = await serial.getPorts()
    if (!port) return false
    try {
      await this.open(port)
      return true
    } catch {
      return false
    }
  }

  private async open(port: SerialPortLike) {
    await this.disconnect()
    await port.open({ baudRate: BAUD_RATE })
    this.port = port
    this.lastState = null
    void this.readLoop(port)
  }

  private async readLoop(port: SerialPortLike) {
    const decoder = new TextDecoder()
    const lines = new LineSplitter()
    try {
      while (port.readable && this.port === port) {
        const reader = port.readable.getReader()
        this.reader = reader
        try {
          for (;;) {
            const { value, done } = await reader.read()
            if (done) break
            for (const raw of lines.push(decoder.decode(value, { stream: true }))) {
              const line = raw.trim().toUpperCase()
              if (line === 'PRESS') this.callbacks.onPress()
              else if (line === 'RELEASE') this.callbacks.onRelease()
            }
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
      this.callbacks.onDisconnect?.()
    }
  }

  /** Tells the button which state to light up. Repeats are skipped. */
  sendState(state: ButtonState): Promise<void> {
    if (!this.port || state === this.lastState) return this.writeChain
    this.lastState = state
    const port = this.port
    const bytes = new TextEncoder().encode(`STATE:${state}\n`)
    this.writeChain = this.writeChain
      .then(async () => {
        if (!port.writable) return
        const writer = port.writable.getWriter()
        try {
          await writer.write(bytes)
        } finally {
          writer.releaseLock()
        }
      })
      .catch(() => undefined)
    return this.writeChain
  }

  async disconnect(): Promise<void> {
    const port = this.port
    this.port = null
    if (!port) return
    try {
      await this.reader?.cancel()
    } catch {
      /* ignore */
    }
    try {
      await this.writeChain
      await port.close()
    } catch {
      /* ignore */
    }
  }
}
