import { CircleCheck, ChefHat, ShieldAlert, TriangleAlert } from 'lucide-react'
import type { GuestAllergies, Order } from '@/api/types'
import { useLabels } from '@/api/queries'
import { formatMoney } from '@/lib/format'

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
          <ul className="mt-4 divide-y divide-line">
            {items.map((item) => (
              <li key={item.id} className="flex gap-3 py-2.5">
                <span className="w-7 shrink-0 font-display text-sm font-semibold tabular text-ink-soft">{item.quantity}×</span>
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
          <div className="mt-2 flex items-baseline justify-between border-t-2 border-ink pt-3">
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
