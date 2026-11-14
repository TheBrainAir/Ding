import type { Allergen, Dish } from '@/api/types'
import { AllergenChips } from '@/components/AllergenChips'
import { DishPhoto } from '@/components/dish/DishPhoto'
import { formatMoney } from '@/lib/format'

/** Cards for the dishes the waiter just looked up or added, newest reply only. */
export function MentionedDishes({
  dishes,
  guestAllergens,
  currency,
}: {
  dishes: Dish[]
  guestAllergens: Allergen[]
  currency: string
}) {
  if (!dishes.length) return null
  return (
    <section className="flex min-h-0 flex-col gap-3" aria-label="Dishes just mentioned">
      <h2 className="font-sans text-sm font-medium text-linen/60">Just mentioned</h2>
      <ul className="grid min-h-0 gap-3 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-1">
        {dishes.map((dish, i) => (
          <li
            key={dish.id}
            className="flex gap-3 rounded-[22px] bg-bistro/80 p-2.5 ring-1 ring-white/10 animate-in fade-in-0 slide-in-from-right-2 fill-mode-both"
            style={{ animationDelay: `${i * 70}ms` }}
          >
            <div className="size-24 shrink-0 overflow-hidden rounded-2xl">
              <DishPhoto src={dish.photo_url} name={dish.name} tone="dark" />
            </div>
            <div className="min-w-0 flex-1 py-0.5">
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate font-semibold text-paper">{dish.name}</p>
                <p className="shrink-0 text-sm tabular text-saffron">{formatMoney(dish.price, currency)}</p>
              </div>
              {dish.description && <p className="mt-0.5 line-clamp-2 text-sm text-linen/70">{dish.description}</p>}
              <AllergenChips
                className="mt-2"
                tone="dark"
                allergens={dish.allergens}
                mayContain={dish.may_contain}
                against={guestAllergens}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
