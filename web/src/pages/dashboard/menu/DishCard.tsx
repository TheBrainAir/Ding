import { CircleAlert } from 'lucide-react'
import type { Allergen, DietaryTag } from '@/api/types'
import { useLabels } from '@/api/queries'
import { AllergenChips } from '@/components/AllergenChips'
import { DishPhoto } from '@/components/dish/DishPhoto'
import SpotlightCard from '@/components/reactbits/SpotlightCard'
import { Switch } from '@/components/ui/switch'
import { formatMoney } from '@/lib/format'
import { cn } from '@/lib/utils'
import { dishFlags } from './dishFlags'

export interface DishCardData {
  name: string
  description: string
  category: string
  price: number | null
  photo_url: string | null
  ingredients: string[]
  allergens: Allergen[]
  may_contain: Allergen[]
  dietary_tags: DietaryTag[]
  available: boolean
}

/**
 * One dish on the menu grid. Also used as the live preview in the dish sheet,
 * so what the owner edits is exactly what the grid will show.
 */
export function DishCard({
  dish,
  currency,
  onEdit,
  onToggle,
  preview = false,
}: {
  dish: DishCardData
  currency: string
  onEdit?: () => void
  onToggle?: (available: boolean) => void
  preview?: boolean
}) {
  const labels = useLabels()
  const flags = dishFlags(dish)
  const name = dish.name.trim() || 'Untitled dish'

  return (
    <SpotlightCard
      theme="light"
      spotlightColor="rgba(242, 169, 59, 0.22)"
      intensity={0.5}
      spotlightSize={260}
      borderGlow={0.6}
      className={cn('flex h-full flex-col !rounded-[28px] !p-0 ring-1 ring-line', !dish.available && 'opacity-75')}
      style={{ '--spotlight-card-surface': 'var(--paper)', '--spotlight-card-shadow': 'none' } as React.CSSProperties}
    >
      <button
        type="button"
        onClick={onEdit}
        disabled={preview}
        className="relative block aspect-[4/3] w-full overflow-hidden text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        aria-label={preview ? undefined : `Edit ${name}`}
        tabIndex={preview ? -1 : undefined}
      >
        <DishPhoto src={dish.photo_url} name={name} className={cn(!dish.available && 'grayscale')} />
        {dish.category && <span className="absolute top-3 left-3 rounded-full bg-paper/95 px-2.5 py-1 text-xs font-medium text-ink">{dish.category}</span>}
        {!dish.available && <span className="absolute top-3 right-3 rounded-full bg-ink px-2.5 py-1 text-xs font-semibold text-paper">Off today</span>}
      </button>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-baseline justify-between gap-3">
          {preview ? (
            <span className="line-clamp-1 font-semibold">{name}</span>
          ) : (
            <button type="button" onClick={onEdit} className="min-w-0 text-left font-semibold hover:underline focus-visible:underline focus-visible:outline-none">
              <span className="line-clamp-1">{name}</span>
            </button>
          )}
          <span className="shrink-0 font-display text-sm font-semibold tabular">{dish.price === null ? '—' : formatMoney(dish.price, currency)}</span>
        </div>
        {dish.description && <p className="line-clamp-2 text-sm text-ink-soft">{dish.description}</p>}
        <AllergenChips allergens={dish.allergens} mayContain={dish.may_contain} />
        {dish.dietary_tags.length > 0 && <p className="text-xs text-bistro">{dish.dietary_tags.map((t) => labels.tag(t)).join(', ')}</p>}
        {flags.length > 0 && (
          <ul className="flex flex-wrap gap-1" aria-label="Missing details">
            {flags.map((f) => (
              <li key={f} className="inline-flex items-center gap-1 rounded-full bg-linen-deep px-2 py-0.5 text-xs text-ink-soft">
                <CircleAlert className="size-3" aria-hidden />
                {f}
              </li>
            ))}
          </ul>
        )}
        <label className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-3 text-sm">
          <span className={dish.available ? 'text-ink' : 'text-ink-soft'}>{dish.available ? 'Available' : 'Unavailable'}</span>
          <Switch
            checked={dish.available}
            onCheckedChange={(v) => onToggle?.(v)}
            disabled={preview}
            aria-label={`${name} available`}
          />
        </label>
      </div>
    </SpotlightCard>
  )
}
