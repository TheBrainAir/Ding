import { PRODUCT_NAME } from '@/config'
import { cn } from '@/lib/utils'

/** The counter bell you press to call someone over. */
export function BellMark({ className, onDark = false }: { className?: string; onDark?: boolean }) {
  const base = onDark ? 'var(--linen)' : 'var(--bistro)'
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn('size-7 shrink-0', className)}>
      <rect x="14.25" y="4.5" width="3.5" height="4" rx="1.6" fill={base} />
      <path d="M4.5 23 A11.5 11.5 0 0 1 27.5 23 Z" fill="var(--saffron)" />
      <path d="M9 18.2 A8 8 0 0 1 13.6 13.3" stroke="var(--paper)" strokeOpacity=".75" strokeWidth="1.8" strokeLinecap="round" fill="none" />
      <rect x="2.5" y="23.5" width="27" height="4" rx="2" fill={base} />
    </svg>
  )
}

export function Wordmark({ className, onDark = false }: { className?: string; onDark?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <BellMark onDark={onDark} />
      <span className={cn('font-display text-xl font-semibold tracking-tight', onDark ? 'text-linen' : 'text-ink')}>
        {PRODUCT_NAME}
      </span>
    </span>
  )
}
