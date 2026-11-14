import { TriangleAlert } from 'lucide-react'
import type { Allergen } from '@/api/types'
import { useLabels } from '@/api/queries'
import { cn } from '@/lib/utils'

/**
 * Allergens of a dish. Anything that clashes with `against` (the guest's
 * declared allergies) is shown in paprika; traces get a lighter treatment.
 */
export function AllergenChips({
  allergens,
  mayContain = [],
  against = [],
  tone = 'light',
  className,
}: {
  allergens: Allergen[]
  mayContain?: Allergen[]
  against?: Allergen[]
  tone?: 'light' | 'dark'
  className?: string
}) {
  const labels = useLabels()
  if (!allergens.length && !mayContain.length) return null
  const clash = new Set(against)

  const base = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium'
  const calm = tone === 'light' ? 'bg-linen-deep text-ink' : 'bg-white/10 text-linen'
  const alarm = 'bg-paprika text-white'

  return (
    <ul className={cn('flex flex-wrap gap-1', className)} aria-label="Allergens">
      {allergens.map((a) => (
        <li key={a} className={cn(base, clash.has(a) ? alarm : calm)}>
          {clash.has(a) && <TriangleAlert className="size-3" aria-hidden />}
          {labels.allergen(a)}
        </li>
      ))}
      {mayContain
        .filter((a) => !allergens.includes(a))
        .map((a) => (
          <li
            key={`may-${a}`}
            className={cn(
              base,
              'border border-dashed',
              clash.has(a) ? 'border-paprika text-paprika' : tone === 'light' ? 'border-input text-ink-soft' : 'border-white/30 text-linen/75',
              clash.has(a) && tone === 'dark' && 'border-[#ff8a80] text-[#ffb4ab]',
            )}
          >
            May contain {labels.allergen(a).toLowerCase()}
          </li>
        ))}
    </ul>
  )
}
