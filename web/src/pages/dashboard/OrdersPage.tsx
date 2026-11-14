import { useCallback, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellRing, Check, ChefHat, Info, Loader2, TriangleAlert, Volume2, VolumeX } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { useDashboardEvent } from '@/api/events'
import { keys, useLabels } from '@/api/queries'
import type { DashboardEvent, Order, OrderStatus, WaiterCall } from '@/api/types'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { clockTime, formatMoney, languageName, minutesSince, timeAgo } from '@/lib/format'
import { audioUnlocked, playNewOrderSound, playWaiterCallSound } from '@/lib/sound'
import { unlockAudio } from '@/lib/voice'
import { cn } from '@/lib/utils'

const MUTE_KEY = 'ding.kitchen.muted'

function readMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

const COLUMNS: { status: OrderStatus[]; title: string; empty: string }[] = [
  { status: ['placed'], title: 'New', empty: 'New orders land here with a bell.' },
  { status: ['preparing'], title: 'Preparing', empty: 'Nothing on the stove.' },
  { status: ['served', 'cancelled'], title: 'Done', empty: 'Served orders show up here.' },
]

export function OrdersPage() {
  const orders = useQuery({ queryKey: keys.orders, queryFn: () => api.orders() })
  const calls = useQuery({ queryKey: keys.waiterCalls, queryFn: () => api.waiterCalls(false) })
  const now = useNow()
  const [muted, setMuted] = useState(readMuted)
  const [soundReady, setSoundReady] = useState(audioUnlocked)
  const [fresh, setFresh] = useState<Set<number>>(() => new Set())

  const onEvent = useCallback(
    (event: DashboardEvent) => {
      if (event.type === 'order.placed') {
        const id = event.data.id
        setFresh((s) => new Set(s).add(id))
        setTimeout(() => setFresh((s) => {
          const next = new Set(s)
          next.delete(id)
          return next
        }), 12_000)
        if (!muted) void playNewOrderSound()
      } else if (event.type === 'waiter.called' && !muted) {
        void playWaiterCallSound()
      }
    },
    [muted],
  )
  useDashboardEvent(onEvent)

  const toggleSound = async () => {
    const ready = await unlockAudio()
    setSoundReady(ready)
    const next = soundReady ? !muted : false
    setMuted(next)
    try {
      localStorage.setItem(MUTE_KEY, next ? '1' : '0')
    } catch {
      /* private window */
    }
    if (!next) void playNewOrderSound()
  }

  const soundOn = soundReady && !muted
  const list = (orders.data ?? []).filter((o) => o.status !== 'draft')
  const openCalls = (calls.data ?? []).filter((c) => !c.resolved)

  return (
    <>
      <PageHeader
        title="Orders"
        description="The kitchen screen. New orders arrive live; move each ticket along as you cook."
        actions={
          <Button variant={soundOn ? 'outline' : 'accent'} onClick={toggleSound} aria-pressed={soundOn}>
            {soundOn ? <Volume2 aria-hidden /> : <VolumeX aria-hidden />}
            {soundOn ? 'Sound on' : 'Turn on sound'}
          </Button>
        }
      />

      {openCalls.length > 0 && (
        <section aria-label="Waiter calls" className="mb-8 grid gap-2">
          {openCalls.map((c) => (
            <WaiterCallRow key={c.id} call={c} now={now} />
          ))}
        </section>
      )}

      {orders.isPending ? (
        <div className="grid gap-6 lg:grid-cols-3">
          {COLUMNS.map((c) => (
            <Skeleton key={c.title} className="h-96 rounded-[28px]" />
          ))}
        </div>
      ) : orders.isError ? (
        <p className="text-paprika">Could not load orders: {orders.error.message}</p>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-3">
          {COLUMNS.map((col) => {
            let items = list.filter((o) => col.status.includes(o.status))
            // Oldest first where cooks work; newest first in the done pile.
            items = col.title === 'Done' ? items.slice(0, 12) : [...items].reverse()
            return (
              <section key={col.title} aria-labelledby={`col-${col.title}`} className="rounded-[28px] bg-linen-deep/60 p-3">
                <h2 id={`col-${col.title}`} className="flex items-center justify-between px-2 pt-1 pb-3 font-sans text-base font-semibold">
                  {col.title}
                  <span className="grid h-6 min-w-6 place-items-center rounded-full bg-paper px-2 text-sm tabular">{items.length}</span>
                </h2>
                {items.length === 0 ? (
                  <p className="px-2 pb-6 text-sm text-ink-soft">{col.empty}</p>
                ) : (
                  <ul className="grid gap-4">
                    {items.map((o) => (
                      <Ticket key={o.id} order={o} now={now} fresh={fresh.has(o.id)} />
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      )}
    </>
  )
}

function WaiterCallRow({ call, now }: { call: WaiterCall; now: number }) {
  const qc = useQueryClient()
  const resolve = useMutation({
    mutationFn: () => api.resolveWaiterCall(call.id),
    onSuccess: (updated) => {
      qc.setQueryData<WaiterCall[]>(keys.waiterCalls, (l) => l?.map((c) => (c.id === updated.id ? updated : c)))
      qc.invalidateQueries({ queryKey: keys.stats })
    },
    onError: (err: Error) => toast.error('Could not resolve the call', { description: err.message }),
  })
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[20px] bg-saffron px-4 py-3 text-ink animate-in fade-in-0 slide-in-from-top-1" role="alert">
      <BellRing className="size-5 shrink-0" aria-hidden />
      <p className="min-w-0 flex-[1_1_16rem]">
        <span className="font-semibold">{call.table_label} asked for a person.</span> {call.reason}
      </p>
      <span className="text-sm text-ink/70">{timeAgo(call.created_at, now)}</span>
      <Button size="sm" onClick={() => resolve.mutate()} disabled={resolve.isPending}>
        {resolve.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
        Mark resolved
      </Button>
    </div>
  )
}

const NEXT: Partial<Record<OrderStatus, { to: OrderStatus; label: string }>> = {
  placed: { to: 'preparing', label: 'Start preparing' },
  preparing: { to: 'served', label: 'Mark served' },
}

function Ticket({ order, now, fresh }: { order: Order; now: number; fresh: boolean }) {
  const qc = useQueryClient()
  const labels = useLabels()
  const advance = useMutation({
    mutationFn: (status: OrderStatus) => api.updateOrder(order.id, status),
    onSuccess: (updated) => {
      qc.setQueryData<Order[]>(keys.orders, (l) => l?.map((o) => (o.id === updated.id ? updated : o)))
      qc.invalidateQueries({ queryKey: keys.stats })
    },
    onError: (err: Error) => toast.error(`Could not update order ${order.id}`, { description: err.message }),
  })

  const since = order.placed_at ?? order.created_at
  const mins = minutesSince(since, now)
  // Red means a declared allergen. A note without allergens (e.g. "No allergies declared") is shown calmly.
  const hasAllergy = order.allergies.length > 0
  const flagged = order.items.some((i) => i.allergen_flag)
  const next = NEXT[order.status]
  const done = order.status === 'served' || order.status === 'cancelled'
  const late = order.status !== 'served' && order.status !== 'cancelled' && mins >= 20

  return (
    <li
      className={cn(
        'ticket relative bg-paper pb-5 transition-colors duration-1000',
        fresh && 'bg-saffron-soft',
        done && 'opacity-75',
      )}
    >
      {hasAllergy || flagged ? (
        <div className="bg-paprika px-4 py-2.5 text-white" role="alert">
          <p className="flex items-center gap-2 font-semibold">
            <TriangleAlert className="size-4 shrink-0" aria-hidden />
            {hasAllergy ? `Allergy: ${order.allergies.map((a) => labels.allergen(a)).join(', ')}` : 'Allergen risk on this ticket'}
          </p>
          {order.allergy_note && <p className="mt-0.5 pl-6 text-sm text-white/90">{order.allergy_note}</p>}
        </div>
      ) : (
        order.allergy_note && (
          <p className="flex items-center gap-2 bg-linen-deep px-4 py-2 text-sm text-ink">
            <Info className="size-4 shrink-0 text-ink-soft" aria-hidden />
            {order.allergy_note}
          </p>
        )
      )}

      <div className="flex items-start justify-between gap-3 px-4 pt-3">
        <div>
          <p className="font-display text-xl font-semibold">{order.table_label}</p>
          <p className="text-xs text-ink-soft">
            Order {order.id}
            {order.language && <> in {languageName(order.language)}</>}
          </p>
        </div>
        <div className="text-right">
          <p className={cn('font-display text-sm font-semibold tabular', late && 'text-paprika')}>{done ? clockTime(since) : `${mins} min`}</p>
          {order.status === 'cancelled' && <p className="text-xs font-semibold text-ink-soft">Cancelled</p>}
        </div>
      </div>

      <ul className="mx-4 mt-3 border-t border-dashed border-input pt-2">
        {order.items.map((item) => (
          <li
            key={item.id}
            className={cn('flex gap-2 py-1.5', item.allergen_flag && '-mx-2 my-1 rounded-lg bg-paprika-soft px-2 text-paprika-deep')}
          >
            <span className="w-7 shrink-0 font-display font-semibold tabular">{item.quantity}×</span>
            <div className="min-w-0 flex-1">
              <p className="font-medium">{item.name}</p>
              {item.notes && <p className="text-sm italic opacity-80">{item.notes}</p>}
              {item.allergen_flag && (
                <p className="mt-0.5 flex items-center gap-1 text-xs font-bold">
                  <TriangleAlert className="size-3" aria-hidden />
                  Contains a declared allergen. Guest accepted the risk.
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>

      <div className="mx-4 mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-input pt-3">
        <span className="text-sm text-ink-soft tabular">{formatMoney(order.total, order.currency)}</span>
        <div className="ml-auto flex flex-wrap justify-end gap-1.5">
          {order.status === 'placed' && (
            <Button variant="ghost" size="sm" onClick={() => advance.mutate('cancelled')} disabled={advance.isPending}>
              Cancel
            </Button>
          )}
          {next && (
            <Button size="sm" onClick={() => advance.mutate(next.to)} disabled={advance.isPending}>
              {advance.isPending ? <Loader2 className="animate-spin" aria-hidden /> : next.to === 'preparing' ? <ChefHat aria-hidden /> : <Check aria-hidden />}
              {next.label}
            </Button>
          )}
        </div>
      </div>
    </li>
  )
}
