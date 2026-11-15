import { useCallback, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, LayoutGroup, motion, MotionConfig } from 'motion/react'
import { BellRing, Check, Loader2, Maximize2, Volume2, VolumeX } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { useDashboardEvent } from '@/api/events'
import { keys } from '@/api/queries'
import type { DashboardEvent, Order, OrderStatus, WaiterCall } from '@/api/types'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { timeAgo } from '@/lib/format'
import { audioUnlocked, playNewOrderSound, playWaiterCallSound } from '@/lib/sound'
import { unlockAudio } from '@/lib/voice'
import { cn } from '@/lib/utils'
import { useShell } from '../shell/shellContext'
import { OrderSheet } from './OrderSheet'
import { Ticket } from './Ticket'

const MUTE_KEY = 'ding.kitchen.muted'
const FRESH_MS = 15_000

function readMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

function useNow(intervalMs = 20_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

const COLUMNS: { key: string; status: OrderStatus[]; title: string; empty: string }[] = [
  { key: 'new', status: ['placed'], title: 'New', empty: 'New orders land here with a bell.' },
  { key: 'cooking', status: ['preparing'], title: 'Cooking', empty: 'Nothing on the stove.' },
  { key: 'done', status: ['served', 'cancelled'], title: 'Done', empty: 'Served orders show up here.' },
]

export function OrdersPage() {
  const qc = useQueryClient()
  const orders = useQuery({ queryKey: keys.orders, queryFn: () => api.orders() })
  const calls = useQuery({ queryKey: keys.waiterCalls, queryFn: () => api.waiterCalls(false) })
  const now = useNow()
  const { kitchenMode, setKitchenMode } = useShell()
  const [muted, setMuted] = useState(readMuted)
  const [soundReady, setSoundReady] = useState(audioUnlocked)
  const [fresh, setFresh] = useState<Set<number>>(() => new Set())
  const [openId, setOpenId] = useState<number | null>(null)
  const [advancingId, setAdvancingId] = useState<number | null>(null)

  const onEvent = useCallback(
    (event: DashboardEvent) => {
      if (event.type === 'order.placed') {
        const id = event.data.id
        setFresh((s) => new Set(s).add(id))
        setTimeout(
          () =>
            setFresh((s) => {
              const next = new Set(s)
              next.delete(id)
              return next
            }),
          FRESH_MS,
        )
        if (!muted) void playNewOrderSound()
      } else if (event.type === 'waiter.called' && !muted) {
        void playWaiterCallSound()
      }
    },
    [muted],
  )
  useDashboardEvent(onEvent)

  const advance = useMutation({
    mutationFn: ({ order, to }: { order: Order; to: OrderStatus }) => api.updateOrder(order.id, to),
    onMutate: async ({ order, to }) => {
      setAdvancingId(order.id)
      await qc.cancelQueries({ queryKey: keys.orders })
      const prev = qc.getQueryData<Order[]>(keys.orders)
      qc.setQueryData<Order[]>(keys.orders, (l) => l?.map((o) => (o.id === order.id ? { ...o, status: to } : o)))
      return { prev }
    },
    onError: (err: Error, { order }, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.orders, ctx.prev)
      toast.error(`Could not update order ${order.id}`, { description: err.message })
    },
    onSuccess: (updated) => {
      qc.setQueryData<Order[]>(keys.orders, (l) => l?.map((o) => (o.id === updated.id ? updated : o)))
      qc.invalidateQueries({ queryKey: keys.stats })
      if (updated.status === 'cancelled') toast(`Order ${updated.id} cancelled`)
    },
    onSettled: () => setAdvancingId(null),
  })

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
  const openOrder = list.find((o) => o.id === openId) ?? null

  const actions = (
    <>
      <Button variant={soundOn ? 'outline' : 'accent'} onClick={toggleSound} aria-pressed={soundOn}>
        {soundOn ? <Volume2 aria-hidden /> : <VolumeX aria-hidden />}
        {soundOn ? 'Sound on' : 'Turn on sound'}
      </Button>
      {!kitchenMode && (
        <Button variant="outline" onClick={() => setKitchenMode(true)}>
          <Maximize2 aria-hidden />
          Kitchen mode
        </Button>
      )}
    </>
  )

  return (
    <MotionConfig reducedMotion="user">
      {kitchenMode ? (
        <div className="mb-5 flex flex-wrap items-center justify-end gap-2">{actions}</div>
      ) : (
        <PageHeader title="Orders" description="The kitchen screen. New orders arrive live with a bell; move each ticket along as you cook." actions={actions} />
      )}

      {openCalls.length > 0 && (
        <section aria-label="Waiter calls" className="sticky top-14 z-20 -mx-1 mb-6 grid gap-2 bg-linen/90 px-1 py-2 backdrop-blur">
          <AnimatePresence initial={false}>
            {openCalls.map((c) => (
              <WaiterCallRow key={c.id} call={c} now={now} large={kitchenMode} />
            ))}
          </AnimatePresence>
        </section>
      )}

      {orders.isPending ? (
        <div className="grid gap-6 lg:grid-cols-3">
          {COLUMNS.map((c) => (
            <Skeleton key={c.key} className="h-96 rounded-[28px]" />
          ))}
        </div>
      ) : orders.isError ? (
        <div className="rounded-[28px] border border-line bg-paper p-6">
          <p>Could not load orders: {orders.error.message}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => orders.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <LayoutGroup>
          <div className={cn('grid items-start gap-6 lg:grid-cols-3', kitchenMode && 'gap-8')}>
            {COLUMNS.map((col) => {
              let items = list.filter((o) => col.status.includes(o.status))
              // Oldest first where cooks work; newest first in the done pile.
              items = col.key === 'done' ? items.slice(0, 12) : [...items].reverse()
              return (
                <section key={col.key} aria-labelledby={`col-${col.key}`} className="rounded-[28px] bg-linen-deep/60 p-3">
                  <h2
                    id={`col-${col.key}`}
                    className={cn('flex items-center justify-between px-2 pt-1 pb-3 font-sans font-semibold', kitchenMode ? 'text-xl' : 'text-base')}
                  >
                    {col.title}
                    <span className="grid h-6 min-w-6 place-items-center rounded-full bg-paper px-2 text-sm tabular">{items.length}</span>
                  </h2>
                  {items.length === 0 ? (
                    <p className="px-2 pb-6 text-sm text-ink-soft">{col.empty}</p>
                  ) : (
                    <ul className="grid gap-4">
                      <AnimatePresence initial={false}>
                        {items.map((o) => (
                          <Ticket
                            key={o.id}
                            order={o}
                            now={now}
                            fresh={fresh.has(o.id)}
                            large={kitchenMode}
                            advancing={advancingId === o.id}
                            onAdvance={(to) => advance.mutate({ order: o, to })}
                            onOpen={() => setOpenId(o.id)}
                          />
                        ))}
                      </AnimatePresence>
                    </ul>
                  )}
                </section>
              )
            })}
          </div>
        </LayoutGroup>
      )}

      <OrderSheet
        order={openOrder}
        now={now}
        onOpenChange={(open) => !open && setOpenId(null)}
        onAdvance={(order, to) => advance.mutate({ order, to })}
        advancing={advancingId === openOrder?.id}
      />
    </MotionConfig>
  )
}

function WaiterCallRow({ call, now, large }: { call: WaiterCall; now: number; large: boolean }) {
  const qc = useQueryClient()
  const resolve = useMutation({
    mutationFn: () => api.resolveWaiterCall(call.id),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: keys.waiterCalls })
      const prev = qc.getQueryData<WaiterCall[]>(keys.waiterCalls)
      qc.setQueryData<WaiterCall[]>(keys.waiterCalls, (l) => l?.map((c) => (c.id === call.id ? { ...c, resolved: true } : c)))
      return { prev }
    },
    onError: (err: Error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.waiterCalls, ctx.prev)
      toast.error('Could not resolve the call', { description: err.message })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.stats })
      toast(`Resolved: ${call.table_label}`)
    },
  })
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginTop: -8 }}
      className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[20px] bg-saffron px-4 text-ink', large ? 'py-4 text-lg' : 'py-3')}
      role="alert"
    >
      <BellRing className="size-5 shrink-0" aria-hidden />
      <p className="min-w-0 flex-[1_1_16rem]">
        <span className="font-semibold">{call.table_label} asked for a person.</span> {call.reason}
      </p>
      <span className="text-sm text-ink/70">{timeAgo(call.created_at, now)}</span>
      <Button size={large ? 'default' : 'sm'} onClick={() => resolve.mutate()} disabled={resolve.isPending}>
        {resolve.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
        Resolve
      </Button>
    </motion.div>
  )
}
