import type { Order } from '@/api/types'
import { LCD_WIDTH, lcdText } from '@/lib/voice'

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
