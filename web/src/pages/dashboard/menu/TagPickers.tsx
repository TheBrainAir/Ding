import { Sparkles } from 'lucide-react'
import type { MetaOption } from '@/api/types'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'

/** Marks an option the AI ticked and nobody has confirmed yet. */
export function AiMark({ className }: { className?: string }) {
  return (
    <span
      className={cn('inline-flex items-center gap-0.5 rounded-full bg-saffron-soft px-1.5 text-[0.7rem] font-semibold text-[#7a4a00]', className)}
      title="AI-suggested — verify"
    >
      <Sparkles className="size-3" aria-hidden />
      AI
    </span>
  )
}

/** Checkbox grid used for allergens and for "may contain". */
export function CheckboxGrid<T extends string>({
  idPrefix,
  options,
  value,
  onChange,
  suggested,
  tone = 'default',
}: {
  idPrefix: string
  options: MetaOption<T>[]
  value: T[]
  onChange: (next: T[]) => void
  suggested?: Set<T>
  tone?: 'default' | 'traces'
}) {
  const selected = new Set(value)
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
      {options.map((opt) => {
        const id = `${idPrefix}-${opt.id}`
        const checked = selected.has(opt.id)
        const ai = checked && suggested?.has(opt.id)
        return (
          <label
            key={opt.id}
            htmlFor={id}
            className={cn(
              'flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-linen',
              checked && tone === 'default' && 'bg-paprika-soft/60',
              checked && tone === 'traces' && 'bg-linen-deep/70',
              ai && 'outline outline-1 outline-dashed outline-saffron-deep',
            )}
          >
            <Checkbox
              id={id}
              checked={checked}
              onCheckedChange={(on) => onChange(on ? [...value, opt.id] : value.filter((v) => v !== opt.id))}
              className={cn(tone === 'default' && 'data-[state=checked]:border-paprika data-[state=checked]:bg-paprika')}
            />
            <span className="flex-1">{opt.label}</span>
            {ai && <AiMark />}
          </label>
        )
      })}
    </div>
  )
}

/** Toggle chips for dietary tags (and the compact allergen picker in menu import). */
export function ToggleChips<T extends string>({
  options,
  value,
  onChange,
  suggested,
  size = 'md',
  activeClass = 'bg-bistro text-paper border-bistro',
  label,
}: {
  options: MetaOption<T>[]
  value: T[]
  onChange: (next: T[]) => void
  suggested?: Set<T>
  size?: 'sm' | 'md'
  activeClass?: string
  label: string
}) {
  const selected = new Set(value)
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const on = selected.has(opt.id)
        const ai = on && suggested?.has(opt.id)
        return (
          <button
            key={opt.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== opt.id) : [...value, opt.id])}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
              size === 'md' ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-xs',
              on ? activeClass : 'border-input bg-paper text-ink-soft hover:text-ink',
              ai && 'border-dashed',
            )}
          >
            {opt.label}
            {ai && <AiMark className="bg-white/20 text-current" />}
          </button>
        )
      })}
    </div>
  )
}
