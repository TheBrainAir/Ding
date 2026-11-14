import { useState } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { BellRing, ChefHat, QrCode } from 'lucide-react'
import { api } from '@/api/client'
import { keys, useMe } from '@/api/queries'
import type { Stats } from '@/api/types'
import { Panel } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatMoney, hourLabel, languageName, nativeLanguageName } from '@/lib/format'

export function OverviewPage() {
  const me = useMe()
  const stats = useQuery({ queryKey: keys.stats, queryFn: api.stats, refetchInterval: 60_000 })
  const restaurant = me.data?.restaurant.name ?? 'your restaurant'

  if (stats.isPending) {
    return (
      <div className="grid gap-6">
        <Skeleton className="h-24 w-2/3 rounded-3xl" />
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-72 rounded-[28px] lg:col-span-2" />
          <Skeleton className="h-72 rounded-[28px]" />
        </div>
      </div>
    )
  }
  if (stats.isError) {
    return <p className="text-paprika">Could not load today’s numbers: {stats.error.message}</p>
  }

  const s = stats.data
  return (
    <div className="grid gap-8">
      <Headline stats={s} restaurant={restaurant} />

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel className="lg:col-span-2" aria-labelledby="hourly-title">
          <h2 id="hourly-title" className="text-lg font-semibold">
            Orders by hour
          </h2>
          <p className="text-sm text-ink-soft">Today, in your local time</p>
          <HourlyBars data={s.orders_by_hour} />
        </Panel>

        <Panel aria-labelledby="top-title">
          <h2 id="top-title" className="text-lg font-semibold">
            Top dishes
          </h2>
          <p className="text-sm text-ink-soft">Portions ordered today</p>
          <RankedBars
            rows={s.top_dishes.map((d) => ({ key: String(d.dish_id), label: d.name, value: d.quantity }))}
            empty="Dishes appear here once guests start ordering."
            unit={(v) => `${v} ordered`}
          />
        </Panel>

        <Panel className="lg:col-span-2" aria-labelledby="lang-title">
          <h2 id="lang-title" className="text-lg font-semibold">
            Guest languages
          </h2>
          <p className="text-sm text-ink-soft">Conversations today, by the language the guest spoke</p>
          <RankedBars
            rows={s.languages.map((l) => {
              const own = nativeLanguageName(l.language)
              const name = languageName(l.language)
              return { key: l.language, label: name, hint: own && own.toLowerCase() !== name.toLowerCase() ? own : undefined, value: l.sessions }
            })}
            empty="No conversations yet today."
            unit={(v) => `${v} ${v === 1 ? 'conversation' : 'conversations'}`}
          />
        </Panel>

        <Panel aria-labelledby="next-title" className="flex flex-col">
          <h2 id="next-title" className="text-lg font-semibold">
            Jump to
          </h2>
          <div className="mt-4 grid gap-2">
            <Button asChild variant="outline" className="justify-start">
              <Link to="/dashboard/orders">
                <ChefHat aria-hidden />
                Kitchen screen
              </Link>
            </Button>
            <Button asChild variant="outline" className="justify-start">
              <Link to="/dashboard/tables">
                <QrCode aria-hidden />
                Tables and QR codes
              </Link>
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  )
}

function Headline({ stats, restaurant }: { stats: Stats; restaurant: string }) {
  const orders = stats.orders_today
  return (
    <section aria-label="Today">
      <p className="text-ink-soft">Today at {restaurant}</p>
      <h1 className="mt-1 max-w-[22ch] text-[clamp(2rem,4.6vw,3.4rem)] leading-[1.05] font-semibold tracking-[-0.03em]">
        {orders === 0 ? 'No orders yet today' : `${orders} ${orders === 1 ? 'order' : 'orders'}, ${formatMoney(stats.revenue_today, stats.currency)}`}
      </h1>
      <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-3">
        <Fact label="Tables talking now" value={String(stats.active_tables)} />
        <Fact label="Average order" value={orders ? formatMoney(stats.avg_order_value, stats.currency) : '—'} />
        <div className="flex flex-col">
          <dt className="text-sm text-ink-soft">Open waiter calls</dt>
          <dd className="flex items-center gap-2 font-display text-xl font-semibold tabular">
            {stats.open_waiter_calls}
            {stats.open_waiter_calls > 0 && (
              <Link
                to="/dashboard/orders"
                className="inline-flex items-center gap-1 rounded-full bg-saffron px-2.5 py-0.5 font-sans text-xs font-bold text-ink"
              >
                <BellRing className="size-3" aria-hidden />
                Answer
              </Link>
            )}
          </dd>
        </div>
      </dl>
    </section>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-sm text-ink-soft">{label}</dt>
      <dd className="font-display text-xl font-semibold tabular">{value}</dd>
    </div>
  )
}

/** Single-series column chart with a per-bar tooltip. */
function HourlyBars({ data }: { data: Stats['orders_by_hour'] }) {
  const [hover, setHover] = useState<number | null>(null)
  const rows = [...data].sort((a, b) => a.hour.localeCompare(b.hour))
  if (!rows.length || rows.every((r) => r.orders === 0)) {
    return <p className="mt-10 mb-6 text-center text-ink-soft">The chart fills in as orders come through.</p>
  }
  const max = Math.max(1, ...rows.map((r) => r.orders))
  const peak = rows.reduce((best, r, i) => (r.orders > rows[best].orders ? i : best), 0)
  const ticks = max <= 4 ? Array.from({ length: max + 1 }, (_, i) => i) : [0, Math.round(max / 2), max]

  return (
    <figure className="mt-6">
      <div className="relative h-56">
        {ticks.map((t) => (
          <div key={t} className="absolute inset-x-0 flex items-center gap-2" style={{ bottom: `${(t / max) * 100}%` }}>
            <span className="w-5 -translate-y-1/2 text-right text-xs text-ink-soft tabular">{t}</span>
            <span className="h-px flex-1 -translate-y-1/2 bg-line" />
          </div>
        ))}
        <div className="absolute inset-y-0 right-0 left-7 flex items-end gap-[2px]" onMouseLeave={() => setHover(null)}>
          {rows.map((r, i) => (
            <div
              key={r.hour}
              className="relative flex h-full flex-1 items-end"
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              tabIndex={0}
              aria-label={`${hourLabel(r.hour)}: ${r.orders} orders`}
            >
              <div
                className="mx-auto w-full max-w-10 rounded-t-[4px] bg-bistro transition-opacity"
                style={{ height: `${(r.orders / max) * 100}%`, opacity: hover === null || hover === i ? 1 : 0.45 }}
              />
              {(hover === i || (hover === null && i === peak)) && (
                <span className="absolute bottom-[calc(var(--h)+6px)] left-1/2 -translate-x-1/2 rounded-lg bg-ink px-2 py-1 text-xs whitespace-nowrap text-paper tabular" style={{ '--h': `${(r.orders / max) * 100}%` } as React.CSSProperties}>
                  {r.orders} at {hourLabel(r.hour)}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 ml-7 flex gap-[2px]">
        {rows.map((r, i) => (
          <span key={r.hour} className="flex-1 text-center text-xs text-ink-soft">
            {rows.length <= 12 || i % 2 === 0 ? hourLabel(r.hour) : ''}
          </span>
        ))}
      </div>
      <figcaption className="sr-only">Orders per hour today; the peak was {rows[peak].orders} at {hourLabel(rows[peak].hour)}.</figcaption>
    </figure>
  )
}

/** Horizontal single-series bars, value labelled at the end of each row. */
function RankedBars({
  rows,
  empty,
  unit,
}: {
  rows: { key: string; label: string; hint?: string; value: number }[]
  empty: string
  unit: (v: number) => string
}) {
  if (!rows.length) return <p className="mt-6 text-ink-soft">{empty}</p>
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <ol className="mt-5 grid gap-3">
      {rows.slice(0, 8).map((r) => (
        <li key={r.key} title={unit(r.value)}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate font-medium">
              {r.label}
              {r.hint && <span className="font-normal text-ink-soft"> ({r.hint})</span>}
            </span>
            <span className="shrink-0 text-ink-soft tabular">{r.value}</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-linen-deep">
            <div className="h-full rounded-full bg-bistro" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ol>
  )
}
