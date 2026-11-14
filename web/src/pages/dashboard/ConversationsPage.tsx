import { Link, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, MessagesSquare, TriangleAlert } from 'lucide-react'
import { api } from '@/api/client'
import { keys, useLabels, useMe } from '@/api/queries'
import type { GuestAllergies, SessionDetail, SessionSummary } from '@/api/types'
import { EmptyState, PageHeader } from '@/components/PageHeader'
import { Skeleton } from '@/components/ui/skeleton'
import { PRODUCT_NAME } from '@/config'
import { clockTime, formatMoney, languageName, nativeLanguageName, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'

export function ConversationsPage() {
  const { sessionId } = useParams()
  const selected = sessionId ? Number(sessionId) : null
  const sessions = useQuery({ queryKey: keys.sessions, queryFn: api.sessions })

  const sorted = [...(sessions.data ?? [])].sort((a, b) => b.last_activity_at.localeCompare(a.last_activity_at))

  return (
    <>
      <PageHeader title="Conversations" description="What guests asked and what the waiter answered, in the guest's own language." />

      {sessions.isPending ? (
        <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
          <Skeleton className="h-96 rounded-[28px]" />
          <Skeleton className="h-96 rounded-[28px]" />
        </div>
      ) : sessions.isError ? (
        <p className="text-paprika">Could not load conversations: {sessions.error.message}</p>
      ) : sorted.length === 0 ? (
        <EmptyState icon={<MessagesSquare />} title="No conversations yet">
          Open a table and press the button, or try the waiter from Settings. Every conversation is saved here.
        </EmptyState>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
          <nav aria-label="Conversations" className={cn('rounded-[28px] border border-line bg-paper p-2', selected && 'hidden lg:block')}>
            <ul className="grid gap-1">
              {sorted.map((s) => (
                <SessionRow key={s.id} session={s} active={s.id === selected} />
              ))}
            </ul>
          </nav>
          <div className={cn(!selected && 'hidden lg:block')}>
            {selected ? (
              <Transcript id={selected} />
            ) : (
              <div className="grid h-full min-h-64 place-items-center rounded-[28px] border border-dashed border-input text-ink-soft">
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
  const allergic = session.allergies.confirmed && session.allergies.allergens.length > 0
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
          <span className="font-semibold">{session.table_label}</span>
          <span className={cn('text-xs', active ? 'text-paper/70' : 'text-ink-soft')}>{timeAgo(session.last_activity_at)}</span>
        </span>
        <span className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-sm', active ? 'text-paper/80' : 'text-ink-soft')}>
          <span>{languageName(session.language)}</span>
          <span>{session.turn_count} {session.turn_count === 1 ? 'turn' : 'turns'}</span>
          {session.status === 'active' && (
            <span className={cn('rounded-full px-2 text-xs font-semibold', active ? 'bg-saffron text-ink' : 'bg-saffron-soft text-ink')}>Live</span>
          )}
          {allergic && (
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

  if (detail.isPending) return <Skeleton className="h-96 rounded-[28px]" />
  if (detail.isError) return <p className="text-paprika">Could not load this conversation: {detail.error.message}</p>

  const s: SessionDetail = detail.data
  const own = nativeLanguageName(s.language)
  return (
    <article className="rounded-[28px] border border-line bg-paper">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line p-6">
        <div>
          <Link to="/dashboard/conversations" className="mb-2 inline-flex items-center gap-1 text-sm text-ink-soft lg:hidden">
            <ArrowLeft className="size-4" aria-hidden />
            All conversations
          </Link>
          <h2 className="text-xl font-semibold">{s.table_label}</h2>
          <p className="text-sm text-ink-soft">
            Started {clockTime(s.started_at)}, {s.status === 'active' ? 'still going' : 'closed'}
          </p>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <div>
            <dt className="text-ink-soft">Language</dt>
            <dd className="font-semibold">
              {languageName(s.language)}
              {own && <span className="font-normal text-ink-soft"> ({own})</span>}
            </dd>
          </div>
          <div>
            <dt className="text-ink-soft">Allergies</dt>
            <dd>
              <AllergySummary allergies={s.allergies} />
            </dd>
          </div>
          {s.order && (
            <div>
              <dt className="text-ink-soft">Order</dt>
              <dd className="font-semibold">
                {formatMoney(s.order.total, s.order.currency)}, {s.order.status}
              </dd>
            </div>
          )}
        </dl>
      </header>

      <ol className="grid gap-3 p-6">
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
                  'max-w-[75%] rounded-[20px] px-4 py-2.5 leading-relaxed',
                  guest ? 'rounded-tl-md bg-linen-deep text-ink' : 'rounded-tr-md bg-bistro text-paper',
                )}
              >
                {line.text}
              </p>
            </li>
          )
        })}
      </ol>

      {s.order && s.order.items.length > 0 && (
        <footer className="border-t border-line p-6">
          <h3 className="font-sans text-sm font-semibold">Order {s.order.id}</h3>
          <ul className="mt-2 grid gap-1 text-sm">
            {s.order.items.map((it) => (
              <li key={it.id} className={cn('flex justify-between gap-3', it.allergen_flag && 'font-semibold text-paprika')}>
                <span>
                  {it.quantity}× {it.name}
                  {it.notes && <span className="text-ink-soft"> ({it.notes})</span>}
                  {it.allergen_flag && ' — declared allergen, risk accepted'}
                </span>
                <span className="tabular">{formatMoney(it.price * it.quantity, s.order!.currency)}</span>
              </li>
            ))}
          </ul>
        </footer>
      )}
    </article>
  )
}

function AllergySummary({ allergies }: { allergies: GuestAllergies }) {
  const labels = useLabels()
  if (!allergies.confirmed) return <span className="text-ink-soft">Not asked yet</span>
  if (allergies.none_declared || allergies.allergens.length === 0) return <span className="font-semibold text-bistro">None</span>
  return (
    <span className="font-semibold text-paprika">
      {allergies.allergens.map((a) => labels.allergen(a)).join(', ')}
      {allergies.notes && <span className="block font-normal text-ink-soft">{allergies.notes}</span>}
    </span>
  )
}
