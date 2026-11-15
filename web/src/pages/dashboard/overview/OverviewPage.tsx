import { lazy, Suspense, useState } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, BellRing, Check, ChevronDown, Circle, X } from 'lucide-react'
import { api } from '@/api/client'
import { keys, useMe } from '@/api/queries'
import type { Stats } from '@/api/types'
import { DishPhoto } from '@/components/dish/DishPhoto'
import { Panel } from '@/components/PageHeader'
import BlurText from '@/components/reactbits/BlurText'
import CountUp from '@/components/reactbits/CountUp'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { languageName, nativeLanguageName } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useVoiceStatus } from '../shell/useShellData'
import { ActivityFeed } from './ActivityFeed'

// recharts is the heaviest dependency; load it after the numbers are on screen.
const HourlyChart = lazy(() => import('./HourlyChart'))

function greeting(now = new Date()) {
  const h = now.getHours()
  if (h < 5) return 'Late service'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

/** "$" for USD, "€" for EUR, "AMD " for codes without a symbol. */
function currencyAffix(currency: string) {
  const parts = new Intl.NumberFormat('en', { style: 'currency', currency }).formatToParts(1)
  const idx = parts.findIndex((p) => p.type === 'currency')
  const symbol = parts[idx]?.value ?? ''
  const before = idx === 0
  const spaced = symbol.length > 1 ? (before ? `${symbol} ` : ` ${symbol}`) : symbol
  return before ? { prefix: spaced, suffix: '' } : { prefix: '', suffix: spaced }
}

export function OverviewPage() {
  const me = useMe()
  const stats = useQuery({ queryKey: keys.stats, queryFn: api.stats, refetchInterval: 60_000 })
  const restaurant = me.data?.restaurant.name ?? 'your restaurant'

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <BlurText
            text={`${greeting()}, ${restaurant}`}
            animateBy="words"
            direction="bottom"
            delay={90}
            trigger="load"
            className="font-display text-[clamp(1.7rem,3.4vw,2.6rem)] leading-tight font-semibold tracking-[-0.03em] text-ink"
          />
          <p className="mt-1 text-ink-soft">{stats.data ? summaryLine(stats.data) : ' '}</p>
        </div>
      </header>

      <SetupChecklist />

      {stats.isPending ? (
        <Skeleton className="h-28 rounded-[28px]" />
      ) : stats.isError ? (
        <Panel>
          <p>Could not load today’s numbers: {stats.error.message}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => stats.refetch()}>
            Try again
          </Button>
        </Panel>
      ) : (
        <StatStrip stats={stats.data} />
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid min-w-0 gap-6">
          <Panel aria-labelledby="hourly-title">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="hourly-title" className="text-lg font-semibold">
                Orders by hour
              </h2>
              <p className="text-sm text-ink-soft">Today, local time</p>
            </div>
            {stats.data ? (
              <Suspense fallback={<Skeleton className="mt-4 h-56 rounded-2xl" />}>
                <HourlyChart data={stats.data.orders_by_hour} />
              </Suspense>
            ) : (
              <Skeleton className="mt-4 h-56 rounded-2xl" />
            )}
          </Panel>

          <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-2">
            <Panel aria-labelledby="top-title">
              <h2 id="top-title" className="text-lg font-semibold">
                Top dishes today
              </h2>
              <TopDishes stats={stats.data} />
            </Panel>
            <Panel aria-labelledby="lang-title">
              <h2 id="lang-title" className="text-lg font-semibold">
                Guest languages
              </h2>
              <Languages stats={stats.data} />
            </Panel>
          </div>
        </div>

        <Panel aria-labelledby="feed-title" className="h-fit">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 id="feed-title" className="text-lg font-semibold">
              Live activity
            </h2>
            <Link to="/dashboard/orders" className="inline-flex items-center gap-0.5 text-sm text-ink-soft hover:text-ink">
              Kitchen screen
              <ArrowUpRight className="size-3.5" aria-hidden />
            </Link>
          </div>
          <ActivityFeed />
        </Panel>
      </div>
    </div>
  )
}

function summaryLine(s: Stats) {
  if (!s.orders_today) return s.active_tables ? `${s.active_tables} ${s.active_tables === 1 ? 'table is' : 'tables are'} talking to the waiter. No orders yet.` : 'Quiet so far. Orders and conversations show up here live.'
  const calls = s.open_waiter_calls ? `, ${s.open_waiter_calls} waiter ${s.open_waiter_calls === 1 ? 'call' : 'calls'} open` : ''
  return `${s.orders_today} ${s.orders_today === 1 ? 'order' : 'orders'} so far today${calls}.`
}

function StatStrip({ stats }: { stats: Stats }) {
  const money = currencyAffix(stats.currency)
  const cells: { label: string; value: number; decimals?: number; prefix?: string; suffix?: string; href?: string; attention?: boolean }[] = [
    { label: 'Orders today', value: stats.orders_today, href: '/dashboard/orders' },
    { label: 'Revenue', value: stats.revenue_today, decimals: 2, ...money },
    { label: 'Tables talking now', value: stats.active_tables, href: '/dashboard/conversations' },
    { label: 'Average order', value: stats.avg_order_value, decimals: 2, ...money },
    { label: 'Open waiter calls', value: stats.open_waiter_calls, href: '/dashboard/orders', attention: stats.open_waiter_calls > 0 },
  ]
  return (
    <section aria-label="Today at a glance" className="grid grid-cols-2 overflow-hidden rounded-[28px] border border-line bg-paper sm:grid-cols-3 lg:grid-cols-5">
      {cells.map((c, i) => {
        const body = (
          <>
            <span className="flex items-center gap-1.5 text-sm text-ink-soft">
              {c.attention && <BellRing className="size-3.5 text-saffron-deep" aria-hidden />}
              {c.label}
            </span>
            <span className={cn('mt-1 block font-display text-[1.75rem] leading-none font-semibold tabular', c.attention && 'text-saffron-deep')}>
              <CountUp to={c.value} decimals={c.decimals ?? 0} prefix={c.prefix} suffix={c.suffix} duration={1.1} separator="," trigger="load" />
            </span>
          </>
        )
        const cls = cn(
          'block px-5 py-5 outline-none',
          i > 0 && 'border-l border-line',
          i >= 2 && 'max-sm:border-t',
          i === 2 && 'max-sm:border-l-0',
          i === 4 && 'max-sm:border-l-0',
          i >= 3 && 'sm:max-lg:border-t',
          i === 3 && 'sm:max-lg:border-l-0',
          c.attention && 'bg-saffron-soft/50',
        )
        return c.href ? (
          <Link key={c.label} to={c.href} className={cn(cls, 'transition-colors hover:bg-linen focus-visible:bg-linen focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring')}>
            {body}
          </Link>
        ) : (
          <div key={c.label} className={cls}>
            {body}
          </div>
        )
      })}
    </section>
  )
}

function TopDishes({ stats }: { stats: Stats | undefined }) {
  const dishes = useQuery({ queryKey: keys.dishes, queryFn: () => api.dishes() })
  if (!stats) return <Skeleton className="mt-4 h-40 rounded-2xl" />
  if (!stats.top_dishes.length) {
    return (
      <div className="mt-4">
        <p className="text-sm text-ink-soft">Dishes appear here once guests order.</p>
        <Button asChild variant="outline" size="sm" className="mt-3">
          <Link to="/dashboard/menu">Review the menu</Link>
        </Button>
      </div>
    )
  }
  const photos = new Map(dishes.data?.map((d) => [d.id, d.photo_url]))
  const max = Math.max(...stats.top_dishes.map((d) => d.quantity))
  return (
    <ol className="mt-4 grid gap-3">
      {stats.top_dishes.slice(0, 5).map((d) => (
        <li key={d.dish_id} className="flex items-center gap-3">
          <span className="size-11 shrink-0 overflow-hidden rounded-xl">
            <DishPhoto src={photos.get(d.dish_id)} name={d.name} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate font-medium">{d.name}</span>
              <span className="shrink-0 text-ink-soft tabular">{d.quantity}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-linen-deep">
              <div className="h-full rounded-full bg-bistro" style={{ width: `${(d.quantity / max) * 100}%` }} />
            </div>
          </div>
        </li>
      ))}
    </ol>
  )
}

function Languages({ stats }: { stats: Stats | undefined }) {
  if (!stats) return <Skeleton className="mt-4 h-40 rounded-2xl" />
  if (!stats.languages.length) {
    return (
      <div className="mt-4">
        <p className="text-sm text-ink-soft">Each conversation is counted in the language the guest spoke.</p>
        <Button asChild variant="outline" size="sm" className="mt-3">
          <Link to="/dashboard/playground">Try one in Spanish</Link>
        </Button>
      </div>
    )
  }
  const max = Math.max(...stats.languages.map((l) => l.sessions))
  return (
    <ol className="mt-4 grid gap-3">
      {stats.languages.slice(0, 6).map((l) => {
        const own = nativeLanguageName(l.language)
        return (
          <li key={l.language}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate font-medium">
                {languageName(l.language)}
                {own && <span className="font-normal text-ink-soft"> ({own})</span>}
              </span>
              <span className="shrink-0 text-ink-soft tabular">{l.sessions}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-linen-deep">
              <div className="h-full rounded-full bg-saffron-deep" style={{ width: `${(l.sessions / max) * 100}%` }} />
            </div>
          </li>
        )
      })}
    </ol>
  )
}

const HIDE_SETUP_KEY = 'ding.setupHidden'

function readHidden() {
  try {
    return localStorage.getItem(HIDE_SETUP_KEY) === '1'
  } catch {
    return false
  }
}

/** First-run checklist derived from data that already exists. Hides itself once complete. */
function SetupChecklist() {
  const dishes = useQuery({ queryKey: keys.dishes, queryFn: () => api.dishes() })
  const tables = useQuery({ queryKey: keys.tables, queryFn: api.tables })
  const sessions = useQuery({ queryKey: keys.sessions, queryFn: api.sessions })
  const voice = useVoiceStatus()
  const [hidden, setHidden] = useState(readHidden)
  const [open, setOpen] = useState(true)

  if (dishes.isPending || tables.isPending || sessions.isPending || voice === 'loading') return null

  const steps = [
    { done: (dishes.data?.length ?? 0) > 0, title: 'Add your menu', hint: 'Dishes with ingredients and allergens', href: '/dashboard/menu', action: 'Open the menu' },
    { done: (tables.data?.length ?? 0) > 0, title: 'Add a table', hint: 'Each table gets its own screen', href: '/dashboard/tables', action: 'Add a table' },
    { done: (sessions.data?.length ?? 0) > 0, title: 'Have a first conversation', hint: 'Test the waiter as a guest', href: '/dashboard/playground', action: 'Open the Playground' },
    { done: voice === 'on', title: 'Turn on voice', hint: 'Needs an ElevenLabs key on the server', href: '/dashboard/settings?tab=voice', action: 'How to turn it on' },
  ]
  const done = steps.filter((s) => s.done).length
  if (done === steps.length || hidden) return null

  const hide = () => {
    setHidden(true)
    try {
      localStorage.setItem(HIDE_SETUP_KEY, '1')
    } catch {
      /* private window */
    }
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="overflow-hidden rounded-[28px] border border-line bg-paper">
      <div className="flex items-center gap-4 px-5 py-4">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            Set up {done} of {steps.length}
          </p>
          <Progress value={(done / steps.length) * 100} className="mt-2 h-1.5 max-w-xs bg-linen-deep [&>div]:bg-bistro" aria-label="Setup progress" />
        </div>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={open ? 'Collapse setup steps' : 'Show setup steps'}>
            <ChevronDown className={cn('transition-transform', open && 'rotate-180')} aria-hidden />
          </Button>
        </CollapsibleTrigger>
        <Button variant="ghost" size="icon-sm" onClick={hide} aria-label="Hide setup steps">
          <X aria-hidden />
        </Button>
      </div>
      <CollapsibleContent>
        <ol className="grid gap-px border-t border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s) => (
            <li key={s.title} className="flex gap-3 bg-paper p-4 first:rounded-bl-[28px] last:rounded-br-[28px] max-lg:last:rounded-bl-[28px]">
              {s.done ? (
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-bistro text-paper">
                  <Check className="size-3.5" aria-hidden />
                </span>
              ) : (
                <Circle className="size-6 shrink-0 text-input" aria-hidden />
              )}
              <div className="min-w-0">
                <p className={cn('font-medium', s.done && 'text-ink-soft line-through decoration-line')}>{s.title}</p>
                <p className="text-sm text-ink-soft">{s.hint}</p>
                {!s.done && (
                  <Link to={s.href} className="mt-1 inline-block text-sm font-semibold text-ink underline underline-offset-4">
                    {s.action}
                  </Link>
                )}
              </div>
              <span className="sr-only">{s.done ? 'Done' : 'To do'}</span>
            </li>
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  )
}
