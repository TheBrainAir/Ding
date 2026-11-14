import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <header className={cn('mb-8 flex flex-wrap items-end justify-between gap-4', className)}>
      <div className="min-w-0">
        <h1 className="text-[1.75rem] leading-tight font-semibold">{title}</h1>
        {description && <p className="mt-1.5 max-w-[62ch] text-ink-soft">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: ReactNode
  title: string
  children?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center rounded-[28px] border border-dashed border-input px-6 py-14 text-center', className)}>
      {icon && <div className="mb-4 grid size-14 place-items-center rounded-full bg-saffron-soft text-ink [&_svg]:size-6">{icon}</div>}
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      {children && <p className="mt-1.5 max-w-[48ch] text-ink-soft">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function Panel({ className, children, ...rest }: React.ComponentProps<'section'>) {
  return (
    <section className={cn('rounded-[28px] border border-line bg-paper p-6', className)} {...rest}>
      {children}
    </section>
  )
}
