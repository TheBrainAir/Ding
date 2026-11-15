import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, FlaskConical, MessagesSquare, ShieldCheck, TriangleAlert } from 'lucide-react'
import { api } from '@/api/client'
import { keys, useLabels, useMe } from '@/api/queries'
import type { GuestAllergies, Order, SessionDetail, SessionSummary } from '@/api/types'
import { EmptyState, PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { PRODUCT_NAME } from '@/config'
import { clockTime, formatMoney, languageName, nativeLanguageName, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'

type Filter = 'all' | 'live' | 'allergies'

const hasAllergies = (a: GuestAllergies) => a.confirmed && a.allergens.length > 0

export function ConversationsPage() {
  const { sessionId } = useParams()
  const selected = sessionId ? Number(sessionId) : null
  const sessions = useQuery({ queryKey: keys.sessions, queryFn: api.sessions })
  const [filter, setFilter] = useState<Filter>('all')
  const [lang, setLang] = useState('all')

  const sorted = useMemo(
    () => [...(sessions.data ?? [])].sort((a, b) => b.last_activity_at.localeCompare(a.last_activity_at)),
    [sessions.data],
  )
  const languages = useMemo(() => [...new Set(sorted.map((s) => s.language).filter((l): l is string => !!l))], [sorted])
  const visible = sorted.filter(
    (s) =>
      (filter === 'all' || (filter === 'live' ? s.status === 'active' : hasAllergies(s.allergies))) &&
      (lang === 'all' || s.language === lang),
  )
  const liveCount = sorted.filter((s) => s.status === 'active').length

  return (
    <>
      <PageHeader title="Conversations" description="What guests asked and what the waiter answered, in the guest's own language." />

      {sessions.isPending ? (
        <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
          <Skeleton className="h-[480px] rounded-[28px]" />
          <Skeleton className="h-[480px] rounded-[28px]" />
        </div>
      ) : sessions.isError ? (
        <div className="rounded-[28px] border border-line bg-paper p-6">
          <p>Could not load conversations: {sessions.error.message}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => sessions.refetch()}>
            Try again
          </Button>
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={<MessagesSquare />}
          title="No conversations yet"
          action={
            <Button asChild>
              <Link to="/dashboard/playground">
                <FlaskConical aria-hidden />
                Test the waiter
              </Link>
            </Button>
          }
        >
          Every conversation at a table is saved here. Start one yourself in the Playground.
        </EmptyState>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
          <nav aria-label="Conversations" className={cn('rounded-[28px] border border-line bg-paper', selected && 'hidden lg:block')}>
            <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
              <ToggleGroup type="single" value={filter} onValueChange={(v) => v && setFilter(v as Filter)} variant="outline" aria-label="Show">
                <ToggleGroupItem value="all" className="h-8 px-3 text-sm">
                  All
                </ToggleGroupItem>
                <ToggleGroupItem value="live" className="h-8 px-3 text-sm">
                  Live {liveCount > 0 && <span className="text-ink-soft tabular">{liveCount}</span>}
                </ToggleGroupItem>
                <ToggleGroupItem value="allergies" className="h-8 px-3 text-sm">
                  Allergies
                </ToggleGroupItem>
              </ToggleGroup>
              {languages.length > 1 && (
                <Select value={lang} onValueChange={setLang}>
                  <SelectTrigger size="sm" className="ml-auto w-auto min-w-28" aria-label="Language">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any language</SelectItem>
                    {languages.map((l) => (
                      <SelectItem key={l} value={l}>
                        {languageName(l)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            {visible.length === 0 ? (
              <p className="p-6 text-sm text-ink-soft">No conversations match. Pick another filter.</p>
            ) : (
              <ul className="grid max-h-[calc(100dvh-18rem)] gap-1 overflow-y-auto p-2">
                {visible.map((s) => (
                  <SessionRow key={s.id} session={s} active={s.id === selected} />
                ))}
              </ul>
            )}
          </nav>
          <div className={cn('min-w-0', !selected && 'hidden lg:block')}>
            {selected ? (
              <Transcript id={selected} />
            ) : (
              <div className="grid min-h-80 place-items-center rounded-[28px] border border-dashed border-input p-6 text-center text-ink-soft">
                Pick a conversation to read it.
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function SessionRow({ session, active }: { session: SessionSummary; active: boolean }) {
  const live = session.status === 'active'
  return (
    <li>
      <Link
        to={`/dashboard/conversations/${session.id}`}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex flex-col gap-1 rounded-[20px] px-4 py-3 transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
          active ? 'bg-bistro text-paper' : 'hover:bg-linen',
        )}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 font-semibold">
            {live && (
              <span className="relative flex size-2" title="Talking now">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-saffron opacity-60 motion-reduce:hidden" />
                <span className="relative inline-flex size-2 rounded-full bg-saffron" />
              </span>
            )}
            {session.table_label}
          </span>
          <span className={cn('text-xs', active ? 'text-paper/70' : 'text-ink-soft')}>{timeAgo(session.last_activity_at)}</span>
        </span>
        <span className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-sm', active ? 'text-paper/80' : 'text-ink-soft')}>
          <span>{languageName(session.language)}</span>
          <span>
            {session.turn_count} {session.turn_count === 1 ? 'turn' : 'turns'}
          </span>
          {session.order_id && <span>Ordered</span>}
          {hasAllergies(session.allergies) && (
            <span className={cn('inline-flex items-center gap-1 text-xs font-semibold', active ? 'text-[#ffb4ab]' : 'text-paprika')}>
              <TriangleAlert className="size-3" aria-hidden />
              Allergies
            </span>
          )}
        </span>
      </Link>
    </li>
  )
}

function Transcript({ id }: { id: number }) {
  const me = useMe()
  const persona = me.data?.restaurant.persona_name || PRODUCT_NAME
  const detail = useQuery({ queryKey: keys.session(id), queryFn: () => api.session(id) })

  if (detail.isPending) return <Skeleton className="h-[480px] rounded-[28px]" />
  if (detail.isError) {
    return (
      <div className="rounded-[28px] border border-line bg-paper p-6">
        <p>Could not load this conversation: {detail.error.message}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => detail.refetch()}>
          Try again
        </Button>
      </div>
    )
  }

  const s: SessionDetail = detail.data
  const own = nativeLanguageName(s.language)
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
      <article className="min-w-0 rounded-[28px] border border-line bg-paper">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line p-5 sm:p-6">
          <div>
            <Link to="/dashboard/conversations" className="mb-2 inline-flex items-center gap-1 text-sm text-ink-soft lg:hidden">
              <ArrowLeft className="size-4" aria-hidden />
              All conversations
            </Link>
            <h2 className="flex items-center gap-2 text-xl font-semibold">
              {s.table_label}
              {s.status === 'active' && <span className="rounded-full bg-saffron-soft px-2 py-0.5 font-sans text-xs font-semibold text-ink">Live</span>}
            </h2>
            <p className="text-sm text-ink-soft">
              Started {clockTime(s.started_at)} in {languageName(s.language)}
              {own && ` (${own})`}, {s.turn_count} {s.turn_count === 1 ? 'turn' : 'turns'}
            </p>
          </div>
        </header>

        <ol className="grid gap-3 bg-linen/40 p-5 sm:p-6">
          {s.transcript.length === 0 && <li className="text-ink-soft">Nothing was said yet.</li>}
          {s.transcript.map((line, i) => {
            const guest = line.role === 'guest'
            return (
              <li key={i} className={cn('flex flex-col', guest ? 'items-start' : 'items-end')}>
                <span className="mb-1 px-1 text-xs text-ink-soft">
                  {guest ? 'Guest' : persona}, {clockTime(line.at)}
                </span>
                <p
                  className={cn(
                    'max-w-[80%] rounded-[20px] px-4 py-2.5 leading-relaxed',
                    guest ? 'rounded-tl-md bg-paper text-ink ring-1 ring-line' : 'rounded-tr-md bg-bistro text-paper',
                  )}
                >
                  {line.text}
                </p>
              </li>
            )
          })}
        </ol>
      </article>

      <aside className="grid gap-3 text-sm xl:sticky xl:top-20" aria-label="Guest details">
        <AllergyCard allergies={s.allergies} />
        <OrderCard order={s.order} />
      </aside>
    </div>
  )
}

function AllergyCard({ allergies }: { allergies: GuestAllergies }) {
  const labels = useLabels()
  if (!allergies.confirmed) {
    return (
      <div className="rounded-[20px] border border-line bg-paper p-4">
        <p className="font-semibold">Allergies</p>
        <p className="mt-1 text-ink-soft">Not asked yet.</p>
      </div>
    )
  }
  if (!allergies.allergens.length) {
    return (
      <div className="flex items-start gap-2 rounded-[20px] bg-sage-soft p-4 text-bistro">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div>
          <p className="font-semibold">No allergies declared</p>
          {allergies.notes && <p className="mt-0.5">{allergies.notes}</p>}
        </div>
      </div>
    )
  }
  return (
    <div className="rounded-[20px] bg-paprika p-4 text-white" role="note">
      <p className="flex items-center gap-2 font-semibold">
        <TriangleAlert className="size-4 shrink-0" aria-hidden />
        Allergies: {allergies.allergens.map((a) => labels.allergen(a)).join(', ')}
      </p>
      {allergies.notes && <p className="mt-1 pl-6 text-white/90">{allergies.notes}</p>}
    </div>
  )
}

function OrderCard({ order }: { order: Order | null }) {
  if (!order) {
    return (
      <div className="rounded-[20px] border border-line bg-paper p-4">
        <p className="font-semibold">Order</p>
        <p className="mt-1 text-ink-soft">No order in this conversation.</p>
      </div>
    )
  }
  return (
    <div className="rounded-[20px] border border-line bg-paper p-4">
      <p className="flex items-baseline justify-between font-semibold">
        Order {order.id}
        <span className="font-normal text-ink-soft">{order.status}</span>
      </p>
      <ul className="mt-2 grid gap-1">
        {order.items.map((it) => (
          <li key={it.id} className={cn('flex justify-between gap-2', it.allergen_flag && 'font-semibold text-paprika')}>
            <span>
              {it.quantity}× {it.name}
            </span>
            <span className="tabular">{formatMoney(it.price * it.quantity, order.currency)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 flex justify-between border-t border-line pt-2 font-semibold">
        Total <span className="tabular">{formatMoney(order.total, order.currency)}</span>
      </p>
      <Button asChild variant="outline" size="sm" className="mt-3 w-full">
        <Link to="/dashboard/orders">Open the kitchen screen</Link>
      </Button>
    </div>
  )
}
