import type { Order } from '@/api/types'
import { marqueePassMs } from '@/lib/voice'
import { orderInfoLines, type InfoLine } from './buttonInfo'

/** How long a line that fits the 16-character display stays up. */
export const SHORT_LINE_DWELL_MS = 2500

/** Time on screen for one line: a fixed dwell, or one full marquee pass for long lines. */
export function dwellMs(text: string): number {
  return marqueePassMs(text) || SHORT_LINE_DWELL_MS
}

/**
 * Pages LCD line 2 of the table button through the order: "1x Mushroom Gyoza",
 * "1x Korean BBQ Beef Bowl", ..., then "3 items $39.00", and around again. When an item is
 * added (or its quantity goes up) the rotation jumps to it so the guest sees the choice
 * confirmed; when the order is sent it jumps to "Order sent".
 *
 * It only runs while the button is connected (start / stop), and `resume()` shows the
 * current line again with a fresh dwell after the board said READY.
 */
export class InfoRotation {
  private send: (text: string) => void
  private lines: InfoLine[] = []
  private index = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private primed = false
  private quantities = new Map<string, number>()
  private orderKey: string | null = null

  constructor(send: (text: string) => void) {
    this.send = send
  }

  /** The line on screen now (or next, while stopped). */
  get current(): string | null {
    return this.lines[this.index]?.text ?? null
  }

  get isRunning(): boolean {
    return this.running
  }

  update(order: Order | null, tableLabel: string) {
    const next = orderInfoLines(order, tableLabel)
    const jumpTo = this.noticeChanges(order)
    const unchanged =
      next.length === this.lines.length && next.every((l, i) => l.key === this.lines[i].key && l.text === this.lines[i].text)
    if (unchanged && jumpTo === null) return

    const previousKey = this.lines[this.index]?.key
    let index = jumpTo !== null ? next.findIndex((l) => l.key === jumpTo) : -1
    if (index < 0 && previousKey) index = next.findIndex((l) => l.key === previousKey)
    if (index < 0) index = Math.min(this.index, next.length - 1)
    const moved = jumpTo !== null || next[index]?.key !== previousKey
    this.lines = next
    this.index = Math.max(0, index)

    if (!this.running) return
    if (moved || !this.timer) this.show()
    else this.send(this.lines[this.index].text) // same line, new text (e.g. the total): keep its time
  }

  /** Begin (or continue) on the current line. Call when the button connects. */
  start() {
    if (this.running) return
    this.running = true
    this.show()
  }

  /** The board forgot what it showed (READY, reconnect): show the current line again, full time. */
  resume() {
    this.running = true
    this.show()
  }

  /** The button went away, or the page is closing. */
  stop() {
    this.running = false
    this.clearTimer()
  }

  /** Remember quantities; return the key to jump to (newest added item, or the summary once sent). */
  private noticeChanges(order: Order | null): string | null {
    const key = order ? `${order.id}:${order.status === 'draft' ? 'draft' : 'sent'}` : null
    let jumpTo: string | null = null
    if (this.primed && order && order.items.length > 0) {
      for (const item of order.items) {
        const before = this.quantities.get(`item:${item.id}`)
        if (before === undefined || item.quantity > before) jumpTo = `item:${item.id}`
      }
      if (jumpTo === null && key !== this.orderKey && order.status !== 'draft') jumpTo = 'summary'
    }
    this.quantities = new Map((order?.items ?? []).map((item) => [`item:${item.id}`, item.quantity]))
    this.orderKey = key
    this.primed = true
    return jumpTo
  }

  private show() {
    this.clearTimer()
    const line = this.lines[this.index]
    if (!line) return
    this.send(line.text)
    if (this.lines.length > 1) {
      this.timer = setTimeout(() => {
        this.timer = null
        this.index = (this.index + 1) % this.lines.length
        this.show()
      }, dwellMs(line.text))
    }
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}
