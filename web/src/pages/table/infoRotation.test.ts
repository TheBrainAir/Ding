import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Order, OrderStatus } from '@/api/types'
import {
  ButtonLink,
  LCD_WIDTH,
  MARQUEE_HOLD_END_MS,
  MARQUEE_HOLD_START_MS,
  MARQUEE_STEP_MS,
  type ButtonLinkCallbacks,
} from '@/lib/voice'
import { addedItemIds, orderInfoLines } from './buttonInfo'
import { InfoRotation, SHORT_LINE_DWELL_MS, dwellMs } from './infoRotation'

const DISHES = {
  gyoza: { name: 'Mushroom Gyoza', price: 11 },
  beef: { name: 'Korean BBQ Beef Bowl', price: 22 },
  lemonade: { name: 'Lemongrass Ginger Lemonade', price: 6 },
}
type DishKey = keyof typeof DISHES

function makeOrder(lines: [DishKey, number][], status: OrderStatus = 'draft', id = 9): Order {
  const ids: Record<DishKey, number> = { gyoza: 31, beef: 32, lemonade: 33 }
  const items = lines.map(([dish, quantity]) => ({
    id: ids[dish],
    dish_id: ids[dish],
    name: DISHES[dish].name,
    price: DISHES[dish].price,
    quantity,
    notes: null,
    allergen_flag: false,
    photo_url: null,
  }))
  return {
    id,
    table_id: 1,
    table_label: 'Table 1',
    session_id: 3,
    status,
    items,
    total: items.reduce((sum, i) => sum + i.price * i.quantity, 0),
    currency: 'USD',
    allergies: [],
    allergy_note: null,
    language: null,
    placed_at: null,
    created_at: '2026-11-14T18:00:00Z',
  }
}

const FULL = makeOrder([
  ['gyoza', 1],
  ['beef', 1],
  ['lemonade', 1],
])

function rotation() {
  const sent: string[] = []
  const r = new InfoRotation((text) => sent.push(text))
  return { r, sent }
}

const pass = (text: string) => MARQUEE_HOLD_START_MS + (text.length - LCD_WIDTH) * MARQUEE_STEP_MS + MARQUEE_HOLD_END_MS

describe('order lines for the LCD', () => {
  it('lists every item in the order it was added, then the summary', () => {
    expect(orderInfoLines(FULL, 'Table 1').map((l) => l.text)).toEqual([
      '1x Mushroom Gyoza',
      '1x Korean BBQ Beef Bowl',
      '1x Lemongrass Ginger Lemonade',
      '3 items $39.00',
    ])
    expect(orderInfoLines(null, 'Table 1').map((l) => l.text)).toEqual(['Table 1'])
    expect(orderInfoLines(makeOrder([['gyoza', 2]], 'placed'), 'T').map((l) => l.text)).toEqual([
      '2x Mushroom Gyoza',
      'Order sent',
    ])
  })

  it('shows short lines for a fixed time and long lines for one full marquee pass', () => {
    expect(dwellMs('3 items $39.00')).toBe(SHORT_LINE_DWELL_MS)
    expect(dwellMs('1x Korean BBQ Beef Bowl')).toBe(pass('1x Korean BBQ Beef Bowl')) // 23 chars: 4360 ms
    expect(dwellMs('1x Korean BBQ Beef Bowl')).toBe(1200 + 7 * 280 + 1200)
  })

  it('spots added items and raised quantities for the order panel', () => {
    const before = makeOrder([['gyoza', 1]]).items
    expect(addedItemIds(before, makeOrder([['gyoza', 1], ['beef', 1]]).items)).toEqual([32])
    expect(addedItemIds(before, makeOrder([['gyoza', 2]]).items)).toEqual([31])
    expect(addedItemIds(undefined, before)).toEqual([])
  })
})

describe('InfoRotation', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('rotates through the items and the summary, each for its dwell, and loops', () => {
    const { r, sent } = rotation()
    r.update(FULL, 'Table 1')
    r.start()
    const lines = orderInfoLines(FULL, 'Table 1').map((l) => l.text)
    expect(sent).toEqual([lines[0]])
    for (let i = 0; i < lines.length; i++) {
      vi.advanceTimersByTime(dwellMs(lines[i]) - 1)
      expect(sent.length).toBe(i + 1) // not yet
      vi.advanceTimersByTime(1)
      expect(sent.at(-1)).toBe(lines[(i + 1) % lines.length])
    }
  })

  it('jumps to a newly added item at once, then carries on from there', () => {
    const { r, sent } = rotation()
    r.update(makeOrder([['gyoza', 1]]), 'Table 1')
    r.start()
    vi.advanceTimersByTime(1000)
    r.update(makeOrder([['gyoza', 1], ['beef', 1]]), 'Table 1')
    expect(sent.at(-1)).toBe('1x Korean BBQ Beef Bowl')
    vi.advanceTimersByTime(dwellMs('1x Korean BBQ Beef Bowl') - 1)
    expect(sent.at(-1)).toBe('1x Korean BBQ Beef Bowl') // a full dwell, restarted by the jump
    vi.advanceTimersByTime(1)
    expect(sent.at(-1)).toBe('2 items $33.00')
  })

  it('jumps to an item whose quantity went up, and to "Order sent" once placed', () => {
    const { r, sent } = rotation()
    r.update(makeOrder([['gyoza', 1], ['beef', 1]]), 'Table 1')
    r.start()
    r.update(makeOrder([['gyoza', 2], ['beef', 1]]), 'Table 1')
    expect(sent.at(-1)).toBe('2x Mushroom Gyoza')
    r.update(makeOrder([['gyoza', 2], ['beef', 1]], 'placed'), 'Table 1')
    expect(sent.at(-1)).toBe('Order sent')
    r.update(makeOrder([['gyoza', 2], ['beef', 1]], 'preparing'), 'Table 1') // kitchen progress: no jump
    expect(sent.at(-1)).toBe('Being prepared')
  })

  it('starts from the first item after a reload, without jumping', () => {
    const { r, sent } = rotation()
    r.update(FULL, 'Table 1') // the order the page found on load
    r.start()
    expect(sent).toEqual(['1x Mushroom Gyoza'])
  })

  it('shows the table label without a timer when nothing is ordered', () => {
    const { r, sent } = rotation()
    r.update(null, 'Table 1')
    r.start()
    vi.advanceTimersByTime(60_000)
    expect(sent).toEqual(['Table 1'])
  })

  it('stops while the button is disconnected and resumes on the same line', () => {
    const { r, sent } = rotation()
    r.update(FULL, 'Table 1')
    r.start()
    vi.advanceTimersByTime(dwellMs('1x Mushroom Gyoza'))
    expect(sent.at(-1)).toBe('1x Korean BBQ Beef Bowl')
    r.stop()
    vi.advanceTimersByTime(60_000)
    expect(sent.length).toBe(2)
    r.update(makeOrder([['gyoza', 1], ['beef', 1], ['lemonade', 1]]), 'Table 1') // refresh while stopped
    expect(sent.length).toBe(2)
    r.start()
    expect(sent.at(-1)).toBe('1x Korean BBQ Beef Bowl')
  })
})

// ---------------------------------------------------------------- with a real ButtonLink

class FakeLink extends ButtonLink {
  readonly transport = 'usb' as const
  writes: string[] = []
  constructor(callbacks: ButtonLinkCallbacks) {
    super(callbacks)
  }
  connect() {
    return this.markConnected()
  }
  async reconnectKnown() {
    return false
  }
  async disconnect() {
    this.setStatus('disconnected')
  }
  protected async writeRaw(bytes: Uint8Array) {
    this.writes.push(new TextDecoder().decode(bytes))
  }
  board(text: string) {
    this.receive(new TextEncoder().encode(text))
  }
}

describe('InfoRotation over a button link', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('re-sends the current line after READY and gives it a full dwell again', async () => {
    let rotationRef: InfoRotation | null = null
    const link = new FakeLink({ onPress: () => {}, onRelease: () => {}, onReady: () => rotationRef?.resume() })
    const r = new InfoRotation((text) => void link.sendInfo(text))
    rotationRef = r
    await link.connect()
    r.update(FULL, 'Table 1')
    r.start()
    await vi.advanceTimersByTimeAsync(1000)
    expect(link.writes.join('')).toBe('STATE:idle\nINFO:1x Mushroom Gyoza\n')

    link.writes = []
    link.board('READY\n') // the board rebooted mid-line
    await vi.advanceTimersByTimeAsync(0)
    expect(link.writes.join('')).toBe('STATE:idle\nINFO:1x Mushroom Gyoza\n')

    await vi.advanceTimersByTimeAsync(dwellMs('1x Mushroom Gyoza') - 1)
    expect(link.writes.join('')).not.toContain('Korean')
    await vi.advanceTimersByTimeAsync(1)
    expect(link.writes.at(-1)).toBe('INFO:1x Korean BBQ Beef Bowl\n')
  })
})
