import type { ButtonState } from '@/api/types'
import { LineSplitter } from './lineSplitter'

/**
 * What every table-button transport (USB serial, Bluetooth) has in common: the
 * newline-terminated protocol from docs/API.md ("Table button serial protocol").
 *
 *   board → host   PRESS | RELEASE | READY
 *   host → board   STATE:idle|listening|thinking|speaking   INFO:<text, ASCII, 16 chars>
 *
 * The page sets the desired state and info line; the link sends only what the
 * board does not have yet, and sends both again when the board says READY
 * (it rebooted, or a Bluetooth link came back).
 */

export type ButtonTransport = 'usb' | 'bluetooth'
export type ButtonLinkStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

export interface ButtonLinkCallbacks {
  onPress: () => void
  onRelease: () => void
  /** The link went down, is trying to come back, or is back. */
  onStatus?: (status: ButtonLinkStatus) => void
}

export const LCD_WIDTH = 16

/** Text the 16x2 LCD can show: printable ASCII, accents stripped, one '?' per other character. */
export function lcdText(text: string, width = LCD_WIDTH): string {
  const ascii = Array.from(text.normalize('NFKD'))
    .filter((ch) => !/\p{M}/u.test(ch)) // combining accents left over from é → e + ´
    .map((ch) => {
      if (/\s/.test(ch)) return ' '
      const code = ch.codePointAt(0) ?? 0
      return code >= 0x20 && code < 0x7f ? ch : '?'
    })
    .join('')
  return ascii.replace(/ +/g, ' ').trim().slice(0, width).trimEnd()
}

export abstract class ButtonLink {
  abstract readonly transport: ButtonTransport
  protected callbacks: ButtonLinkCallbacks
  private linkStatus: ButtonLinkStatus = 'disconnected'
  private desiredState: ButtonState = 'idle'
  private desiredInfo = ''
  private sentState: ButtonState | null = null
  private sentInfo: string | null = null
  private lines = new LineSplitter()
  private decoder = new TextDecoder()
  private writeChain: Promise<void> = Promise.resolve()

  constructor(callbacks: ButtonLinkCallbacks) {
    this.callbacks = callbacks
  }

  get status(): ButtonLinkStatus {
    return this.linkStatus
  }

  get connected(): boolean {
    return this.linkStatus === 'connected'
  }

  /** Asks the user to pick a device. Must be called from a click handler. */
  abstract connect(): Promise<void>
  /** Re-opens a device the user granted earlier, without a prompt. */
  abstract reconnectKnown(): Promise<boolean>
  abstract disconnect(): Promise<void>
  /** Write raw bytes to the board. Called one at a time, in order. */
  protected abstract writeRaw(bytes: Uint8Array): Promise<void>

  /** What line 1 of the LCD (and the old Uno's LED) should show. Repeats are not sent. */
  sendState(state: ButtonState): Promise<void> {
    this.desiredState = state
    return this.flush()
  }

  /** LCD line 2. Sanitised to ASCII and cut to 16 characters; repeats are not sent. */
  sendInfo(text: string): Promise<void> {
    this.desiredInfo = lcdText(text)
    return this.flush()
  }

  protected setStatus(status: ButtonLinkStatus) {
    if (status === this.linkStatus) return
    this.linkStatus = status
    this.callbacks.onStatus?.(status)
  }

  /**
   * The link is up and the board knows nothing of ours yet: read anew, announce the
   * status (listeners may set a newer state / info right then), then send everything.
   */
  protected markConnected(): Promise<void> {
    this.sentState = null
    this.sentInfo = null
    this.lines = new LineSplitter()
    this.decoder = new TextDecoder()
    this.setStatus('connected')
    return this.flush()
  }

  /** Feed bytes from the board. */
  protected receive(chunk: Uint8Array) {
    for (const raw of this.lines.push(this.decoder.decode(chunk, { stream: true }))) {
      const line = raw.trim().toUpperCase()
      if (line === 'PRESS') this.callbacks.onPress()
      else if (line === 'RELEASE') this.callbacks.onRelease()
      else if (line === 'READY') {
        // The board just started (or a Bluetooth host reconnected): it shows nothing of ours.
        this.sentState = null
        this.sentInfo = null
        void this.flush()
      }
    }
  }

  private flush(): Promise<void> {
    if (!this.connected) return this.writeChain
    if (this.sentState !== this.desiredState) {
      this.sentState = this.desiredState
      this.enqueue(`STATE:${this.desiredState}\n`)
    }
    if (this.desiredInfo && this.sentInfo !== this.desiredInfo) {
      this.sentInfo = this.desiredInfo
      this.enqueue(`INFO:${this.desiredInfo}\n`)
    }
    return this.writeChain
  }

  private enqueue(line: string) {
    const bytes = new TextEncoder().encode(line)
    this.writeChain = this.writeChain.then(() => this.writeRaw(bytes)).catch(() => undefined)
  }
}
