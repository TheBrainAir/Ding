import { motion } from 'motion/react'
import { Check, ChefHat, Loader2, TriangleAlert, Info } from 'lucide-react'
import type { Order, OrderStatus } from '@/api/types'
import { NEXT_STEP, urgency } from './orderSteps'
import { useLabels } from '@/api/queries'
import { Button } from '@/components/ui/button'
import { clockTime, formatMoney, languageName, minutesSince } from '@/lib/format'
import { cn } from '@/lib/utils'

export function ElapsedChip({ order, now, large }: { order: Order; now: number; large?: boolean }) {
  const since = order.placed_at ?? order.created_at
  const done = order.status === 'served' || order.status === 'cancelled'
  if (done) {
    return <span className={cn('font-display font-semibold text-ink-soft tabular', large ? 'text-base' : 'text-sm')}>{clockTime(since)}</span>
  }
  const mins = minutesSince(since, now)
  const level = urgency(mins)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-display font-semibold tabular',
        large ? 'text-base' : 'text-sm',
        level === 'calm' && 'text-ink-soft',
        level === 'warm' && 'bg-saffron-soft text-ink',
        level === 'hot' && 'bg-saffron text-ink',
      )}
      title={`Placed at ${clockTime(since)}`}
    >
      {level === 'hot' && <span className="size-1.5 animate-pulse rounded-full bg-ink" aria-hidden />}
      {mins < 1 ? 'now' : `${mins} min`}
      <span className="sr-only">{level === 'calm' ? '' : level === 'warm' ? ', waiting a while' : ', waiting too long'}</span>
    </span>
  )
}

export function AllergyStrip({ order, large }: { order: Order; large?: boolean }) {
  const labels = useLabels()
  const hasAllergy = order.allergies.length > 0
  const flagged = order.items.some((i) => i.allergen_flag)
  if (hasAllergy || flagged) {
    return (
      <div className={cn('bg-paprika px-4 text-white', large ? 'py-3' : 'py-2.5')} role="alert">
        <p className={cn('flex items-center gap-2 font-bold', large && 'text-lg')}>
          <TriangleAlert className={cn('shrink-0', large ? 'size-5' : 'size-4')} aria-hidden />
          {hasAllergy ? `Allergy: ${order.allergies.map((a) => labels.allergen(a)).join(', ')}` : 'Allergen risk on this ticket'}
        </p>
        {order.allergy_note && <p className={cn('mt-0.5 text-white/90', large ? 'pl-7' : 'pl-6 text-sm')}>{order.allergy_note}</p>}
      </div>
    )
  }
  if (!order.allergy_note) return null
  return (
    <p className="flex items-center gap-2 bg-linen-deep px-4 py-2 text-sm text-ink">
      <Info className="size-4 shrink-0 text-ink-soft" aria-hidden />
      {order.allergy_note}
    </p>
  )
}

export function Ticket({
  order,
  now,
  fresh,
  large,
  advancing,
  onAdvance,
  onOpen,
}: {
  order: Order
  now: number
  fresh: boolean
  large: boolean
  advancing: boolean
  onAdvance: (to: OrderStatus) => void
  onOpen: () => void
}) {
  const next = NEXT_STEP[order.status]
  const done = order.status === 'served' || order.status === 'cancelled'

  return (
    <motion.li
      layout="position"
      layoutId={`ticket-${order.id}`}
      initial={fresh ? { opacity: 0, y: -16, scale: 0.97 } : false}
      animate={{ opacity: done ? 0.72 : 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
      className="ticket relative bg-paper pb-5"
      data-fresh={fresh || undefined}
    >
      <AllergyStrip order={order} large={large} />

      <button
        type="button"
        onClick={onOpen}
        className="block w-full px-4 pt-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        aria-label={`Open order ${order.id} from ${order.table_label}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={cn('flex items-center gap-2 font-display font-semibold', large ? 'text-2xl' : 'text-xl')}>
              {order.table_label}
              {fresh && <span className="rounded-full bg-saffron px-2 py-0.5 font-sans text-xs font-bold text-ink">New</span>}
            </p>
            <p className="text-xs text-ink-soft">
              Order {order.id}
              {order.language && <> in {languageName(order.language)}</>}
              {order.status === 'cancelled' && <span className="font-semibold">, cancelled</span>}
            </p>
          </div>
          <ElapsedChip order={order} now={now} large={large} />
        </div>

        <ul className={cn('mt-3 border-t border-dashed border-input pt-2', large && 'text-lg')}>
          {order.items.map((item) => (
            <li
              key={item.id}
              className={cn('flex gap-2 py-1.5', item.allergen_flag && '-mx-2 my-1 rounded-lg bg-paprika-soft px-2 text-paprika-deep')}
            >
              <span className="w-7 shrink-0 font-display font-semibold tabular">{item.quantity}×</span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{item.name}</p>
                {item.notes && <p className="text-sm italic opacity-80">{item.notes}</p>}
                {item.allergen_flag && (
                  <p className="mt-0.5 flex items-center gap-1 text-xs font-bold">
                    <TriangleAlert className="size-3" aria-hidden />
                    Contains a declared allergen. Guest accepted the risk.
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </button>

      <div className="mx-4 mt-2 flex items-center justify-between gap-2 border-t border-dashed border-input pt-3">
        <span className="text-sm text-ink-soft tabular">{formatMoney(order.total, order.currency)}</span>
        {next && (
          <Button size={large ? 'default' : 'sm'} variant={order.status === 'placed' ? 'accent' : 'default'} onClick={() => onAdvance(next.to)} disabled={advancing}>
            {advancing ? <Loader2 className="animate-spin" aria-hidden /> : next.to === 'preparing' ? <ChefHat aria-hidden /> : <Check aria-hidden />}
            {next.label}
          </Button>
        )}
      </div>
    </motion.li>
  )
}
