import { describe, expect, it } from 'vitest'
import type { Order, OrderStatus } from '@/api/types'
import { buttonInfoLine } from './buttonInfo'

function order(status: OrderStatus, quantities: number[], total: number, currency = 'USD'): Order {
  return {
    id: 9,
    table_id: 1,
    table_label: 'Table 1',
    session_id: 3,
    status,
    items: quantities.map((quantity, i) => ({
      id: i + 1,
      dish_id: i + 1,
      name: `Dish ${i + 1}`,
      price: 1,
      quantity,
      notes: null,
      allergen_flag: false,
      photo_url: null,
    })),
    total,
    currency,
    allergies: [],
    allergy_note: null,
    language: null,
    placed_at: null,
    created_at: '2026-11-14T18:00:00Z',
  }
}

describe('buttonInfoLine', () => {
  it('shows the table label when nothing is ordered', () => {
    expect(buttonInfoLine(null, 'Table 4')).toBe('Table 4')
    expect(buttonInfoLine(order('draft', [], 0), 'Table 4')).toBe('Table 4')
    expect(buttonInfoLine(order('cancelled', [1], 9), 'Table 4')).toBe('Table 4')
  })

  it('counts portions and the total of a draft', () => {
    expect(buttonInfoLine(order('draft', [1], 14.5), 'Table 4')).toBe('1 item $14.50')
    expect(buttonInfoLine(order('draft', [2, 1], 29), 'Table 4')).toBe('3 items $29.00')
  })

  it('stays within 16 characters for other currencies and big orders', () => {
    expect(buttonInfoLine(order('draft', [2], 29, 'EUR'), 'T')).toBe('2 items 29 EUR') // "29.00 EUR" would not fit
    expect(buttonInfoLine(order('draft', [12], 1234.5, 'EUR'), 'T')).toBe('12 items 1235')
    for (const o of [order('draft', [99], 99999.99), order('draft', [3], 45.5, 'AMD')]) {
      expect(buttonInfoLine(o, 'T').length).toBeLessThanOrEqual(16)
    }
  })

  it('says where the order is once it left the table', () => {
    expect(buttonInfoLine(order('placed', [1], 9), 'Table 4')).toBe('Order sent')
    expect(buttonInfoLine(order('preparing', [1], 9), 'Table 4')).toBe('Being prepared')
    expect(buttonInfoLine(order('served', [1], 9), 'Table 4')).toBe('Enjoy your meal')
  })

  it('keeps the label ASCII', () => {
    expect(buttonInfoLine(null, 'Терраса 2')).toBe('??????? 2')
    expect(buttonInfoLine(null, '')).toBe('Ding')
  })
})
