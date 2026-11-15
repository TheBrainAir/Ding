import { useEffect, useRef, useState } from 'react'
import { CircleCheck, ChefHat, ShieldAlert, TriangleAlert } from 'lucide-react'
import type { GuestAllergies, Order } from '@/api/types'
import { useLabels } from '@/api/queries'
import { formatMoney } from '@/lib/format'
import { cn } from '@/lib/utils'
import { addedItemIds } from './buttonInfo'

const HIGHLIGHT_MS = 2400

const STATUS_COPY: Record<Order['status'], string> = {
  draft: 'Not sent yet',
  placed: 'Sent to the kitchen',
  preparing: 'Being prepared',
  served: 'Served',
  cancelled: 'Cancelled',
}

export function OrderPanel({
  order,
  allergies,
  currency,
  persona,
}: {
  order: Order | null
  allergies: GuestAllergies | null
  currency: string
  persona: string
}) {
  const items = order?.items ?? []
  const sent = order && order.status !== 'draft'

  // Briefly highlight what was just added and scroll it into view (the list scrolls inside the
  // panel once it is long). Compared during render, so the first paint already has the highlight.
  const [seenItems, setSeenItems] = useState(order?.items)
  const [fresh, setFresh] = useState<number[]>([])
  if (order?.items !== seenItems) {
    setSeenItems(order?.items)
    const added = addedItemIds(seenItems, order?.items)
    if (added.length || fresh.length) setFresh(added)
  }
  const listRef = useRef<HTMLUListElement>(null)
  useEffect(() => {
    if (!fresh.length) return
    const newest = fresh[fresh.length - 1]
    listRef.current
      ?.querySelector(`[data-item-id="${newest}"]`)
      ?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
    const timer = setTimeout(() => setFresh([]), HIGHLIGHT_MS)
    return () => clearTimeout(timer)
  }, [fresh])

  return (
    <section className="rounded-[28px] bg-paper p-5 text-ink shadow-[0_24px_50px_-30px_rgb(0_0_0/0.7)]" aria-labelledby="order-title">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="order-title" className="text-lg font-semibold">
          Your order
        </h2>
        {order && items.length > 0 && (
          <span className={`inline-flex items-center gap-1 text-sm ${sent ? 'text-bistro' : 'text-ink-soft'}`}>
            {sent ? <CircleCheck className="size-4" aria-hidden /> : <ChefHat className="size-4" aria-hidden />}
            {STATUS_COPY[order.status]}
          </span>
        )}
      </div>

      <AllergyLine allergies={allergies} persona={persona} />

      {items.length === 0 ? (
        <p className="mt-4 text-sm text-ink-soft">Nothing ordered yet. Tell {persona} what you would like.</p>
      ) : (
        <>
          <ul
            ref={listRef}
            className="mt-4 max-h-[min(26rem,48dvh)] divide-y divide-line overflow-y-auto overscroll-contain pr-1"
            aria-label="Items in your order"
          >
            {items.map((item) => (
              <li
                key={item.id}
                data-item-id={item.id}
                className={cn(
                  'flex gap-3 rounded-xl px-2 py-2.5 transition-colors duration-700',
                  fresh.includes(item.id) ? 'bg-saffron/25' : 'bg-transparent',
                )}
              >
                <span className="w-8 shrink-0 font-display text-sm font-semibold tabular text-ink-soft">{item.quantity}x</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{item.name}</p>
                  {item.notes && <p className="text-sm text-ink-soft">{item.notes}</p>}
                  {item.allergen_flag && (
                    <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-paprika-soft px-2 py-0.5 text-xs font-semibold text-paprika-deep">
                      <TriangleAlert className="size-3" aria-hidden />
                      Allergen risk, confirmed by you
                    </p>
                  )}
                </div>
                <span className="shrink-0 tabular">{formatMoney(item.price * item.quantity, order?.currency ?? currency)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-baseline justify-between border-t-2 border-ink px-2 pt-3">
            <span className="font-semibold">Total</span>
            <span className="font-display text-xl font-semibold tabular">{formatMoney(order?.total, order?.currency ?? currency)}</span>
          </div>
          {!sent && <p className="mt-2 text-xs text-ink-soft">{persona} will read the order back before sending it to the kitchen.</p>}
        </>
      )}
    </section>
  )
}

function AllergyLine({ allergies, persona }: { allergies: GuestAllergies | null; persona: string }) {
  const labels = useLabels()
  if (!allergies?.confirmed) {
    return (
      <p className="mt-3 flex items-start gap-2 rounded-2xl bg-linen px-3 py-2 text-sm text-ink-soft">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        {persona} will ask about allergies before taking your order.
      </p>
    )
  }
  if (allergies.none_declared || allergies.allergens.length === 0) {
    return (
      <p className="mt-3 flex items-center gap-2 rounded-2xl bg-sage-soft px-3 py-2 text-sm text-bistro">
        <CircleCheck className="size-4 shrink-0" aria-hidden />
        No allergies declared{allergies.notes ? `: ${allergies.notes}` : ''}
      </p>
    )
  }
  return (
    <div className="mt-3 rounded-2xl bg-paprika px-3 py-2.5 text-sm text-white" role="note">
      <p className="flex items-center gap-2 font-semibold">
        <TriangleAlert className="size-4 shrink-0" aria-hidden />
        Allergies: {allergies.allergens.map((a) => labels.allergen(a)).join(', ')}
      </p>
      {allergies.notes && <p className="mt-0.5 pl-6 text-white/85">{allergies.notes}</p>}
    </div>
  )
}
