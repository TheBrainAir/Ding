import type { OrderStatus } from '@/api/types'

export const NEXT_STEP: Partial<Record<OrderStatus, { to: OrderStatus; label: string }>> = {
  placed: { to: 'preparing', label: 'Start cooking' },
  preparing: { to: 'served', label: 'Mark served' },
}

/** How long a ticket has waited, as a calm → warm → hot scale. Never paprika: that is for allergies. */
export function urgency(mins: number): 'calm' | 'warm' | 'hot' {
  if (mins >= 20) return 'hot'
  if (mins >= 10) return 'warm'
  return 'calm'
}
