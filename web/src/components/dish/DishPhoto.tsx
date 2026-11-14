import { useState } from 'react'
import { cn } from '@/lib/utils'

/** A dish photo, or an empty plate with the dish's initial when there is none. */
export function DishPhoto({
  src,
  name,
  className,
  tone = 'light',
}: {
  src: string | null | undefined
  name: string
  className?: string
  tone?: 'light' | 'dark'
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const showImage = !!src && failedSrc !== src

  if (showImage) {
    return (
      <img
        src={src}
        alt={name}
        loading="lazy"
        onError={() => setFailedSrc(src)}
        className={cn('size-full object-cover', className)}
      />
    )
  }
  const initial = name.trim().charAt(0).toUpperCase() || '?'
  return (
    <div
      role="img"
      aria-label={`${name}, no photo yet`}
      className={cn(
        'grid size-full place-items-center',
        tone === 'light' ? 'bg-linen-deep text-ink-soft' : 'bg-bistro text-linen/80',
        className,
      )}
    >
      <span
        className={cn(
          'grid aspect-square w-[46%] max-w-28 place-items-center rounded-full font-display text-2xl font-semibold',
          tone === 'light' ? 'bg-paper shadow-[0_0_0_6px_var(--linen),0_0_0_7px_var(--line)]' : 'bg-bistro-deep shadow-[0_0_0_6px_#1a4030]',
        )}
      >
        {initial}
      </span>
    </div>
  )
}
