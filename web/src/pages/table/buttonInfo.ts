import type { Order, OrderItem } from '@/api/types'
import { INFO_MAX, LCD_WIDTH, lcdText } from '@/lib/voice'

const CURRENCY_PREFIX: Record<string, string> = { USD: '$', CAD: '$', AUD: '$', NZD: '$', SGD: '$', HKD: '$', MXN: '$' }

function money(total: number, currency: string, cents: boolean): string {
  const amount = cents ? total.toFixed(2) : String(Math.round(total))
  const prefix = CURRENCY_PREFIX[currency.toUpperCase()]
  return prefix ? `${prefix}${amount}` : `${amount} ${currency.toUpperCase()}`
}

/**
 * Line 2 of the table button's 16x2 LCD: the table label while nothing is ordered,
 * "N items $X" for a draft, a short status once the order went to the kitchen.
 * Always ASCII and at most 16 characters (the LCD cannot show other scripts).
 */
export function buttonInfoLine(order: Order | null, tableLabel: string): string {
  const label = lcdText(tableLabel) || 'Ding'
  if (!order || order.items.length === 0) return label
  switch (order.status) {
    case 'draft': {
      const count = order.items.reduce((sum, item) => sum + item.quantity, 0)
      const items = `${count} item${count === 1 ? '' : 's'}`
      // Longest first: "2 items $29.00", "2 items 29.00 EUR" -> "2 items 29 EUR", then without the currency.
      const candidates = [
        `${items} ${money(order.total, order.currency, true)}`,
        `${items} ${money(order.total, order.currency, false)}`,
        `${items} ${Math.round(order.total)}`,
        items,
      ]
      return lcdText(candidates.find((line) => line.length <= LCD_WIDTH) ?? items)
    }
    case 'placed':
      return 'Order sent'
    case 'preparing':
      return 'Being prepared'
    case 'served':
      return 'Enjoy your meal'
    default:
      return label
  }
}

/** One line the LCD shows in turn; `key` follows the same item across updates. */
export interface InfoLine {
  key: string
  text: string
}

/** "<qty>x <name>", ASCII, up to INFO_MAX characters (the board scrolls long ones). */
export function itemInfoLine(item: OrderItem): string {
  return lcdText(`${item.quantity}x ${item.name}`, INFO_MAX)
}

/**
 * What line 2 of the LCD cycles through: every item in the order it was added, then the
 * summary ("3 items $51.00", or "Order sent" once placed). Just the table label when
 * nothing is ordered.
 */
export function orderInfoLines(order: Order | null, tableLabel: string): InfoLine[] {
  if (!order || order.items.length === 0 || order.status === 'cancelled') {
    return [{ key: 'label', text: buttonInfoLine(null, tableLabel) }]
  }
  return [
    ...order.items.map((item) => ({ key: `item:${item.id}`, text: itemInfoLine(item) })),
    { key: 'summary', text: buttonInfoLine(order, tableLabel) },
  ]
}

/** Items that are new, or whose quantity went up, compared with the previous list. */
export function addedItemIds(before: OrderItem[] | undefined, after: OrderItem[] | undefined): number[] {
  if (!before || !after) return []
  const previous = new Map(before.map((item) => [item.id, item.quantity]))
  return after.filter((item) => item.quantity > (previous.get(item.id) ?? 0)).map((item) => item.id)
}
