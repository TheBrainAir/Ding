import { useMemo } from 'react'
import { useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { BellRing, ChefHat, CircleCheck, MessagesSquare, ReceiptText, XCircle } from 'lucide-react'
import { api } from '@/api/client'
import { useRecentEvents } from '@/api/events'
import { keys } from '@/api/queries'
import type { DashboardEvent } from '@/api/types'
import AnimatedList, { type AnimatedListEntry } from '@/components/reactbits/AnimatedList'
import { Skeleton } from '@/components/ui/skeleton'
import { clockTime, formatMoney, languageName, timeAgo } from '@/lib/format'

interface FeedItem {
  key: string
  at: string
  kind: 'order' | 'cooking' | 'served' | 'cancelled' | 'call' | 'talk'
  title: string
  description?: string
  href: string
}

const ICON = {
  order: ReceiptText,
  cooking: ChefHat,
  served: CircleCheck,
  cancelled: XCircle,
  call: BellRing,
  talk: MessagesSquare,
}

function fromEvent(event: DashboardEvent, at: string): FeedItem | null {
  switch (event.type) {
    case 'order.placed': {
      const o = event.data
      return {
        key: `order-${o.id}-placed`,
        at: o.placed_at ?? at,
        kind: 'order',
        title: `New order from ${o.table_label}`,
        description: `${countItems(o.items)}, ${formatMoney(o.total, o.currency)}${o.allergies.length ? ', allergies declared' : ''}`,
        href: '/dashboard/orders',
      }
    }
    case 'order.updated': {
      const o = event.data
      if (o.status === 'placed' || o.status === 'draft') return null
      const kind = o.status === 'preparing' ? 'cooking' : o.status === 'served' ? 'served' : 'cancelled'
      const verb = { cooking: 'is being cooked', served: 'was served', cancelled: 'was cancelled' }[kind]
      return { key: `order-${o.id}-${o.status}`, at, kind, title: `${o.table_label} order ${verb}`, description: `Order ${o.id}`, href: '/dashboard/orders' }
    }
    case 'waiter.called': {
      const c = event.data
      return { key: `call-${c.id}`, at: c.created_at, kind: 'call', title: `${c.table_label} asked for a person`, description: c.reason, href: '/dashboard/orders' }
    }
    case 'session.updated': {
      const s = event.data
      if (s.status !== 'active') return null
      return {
        key: `talk-${s.id}`,
        at: s.started_at,
        kind: 'talk',
        title: `${s.table_label} started talking`,
        description: s.language ? `In ${languageName(s.language)}` : undefined,
        href: `/dashboard/conversations/${s.id}`,
      }
    }
  }
}

function countItems(items: { quantity: number }[]): string {
  const n = items.reduce((sum, i) => sum + i.quantity, 0)
  return n === 1 ? '1 item' : `${n} items`
}

/** What just happened in the room: seeded from the lists, then fed live by the event stream. */
export function ActivityFeed() {
  const navigate = useNavigate()
  const recent = useRecentEvents()
  const orders = useQuery({ queryKey: keys.orders, queryFn: () => api.orders() })
  const calls = useQuery({ queryKey: keys.waiterCalls, queryFn: () => api.waiterCalls(false) })
  const sessions = useQuery({ queryKey: keys.sessions, queryFn: api.sessions })

  const items = useMemo(() => {
    const byKey = new Map<string, FeedItem>()
    const add = (item: FeedItem | null) => {
      if (item && !byKey.has(item.key)) byKey.set(item.key, item)
    }
    for (const r of recent) add(fromEvent(r.event, r.at))
    for (const o of orders.data ?? []) if (o.status !== 'draft') add(fromEvent({ type: 'order.placed', data: o }, o.created_at))
    for (const c of calls.data ?? []) add(fromEvent({ type: 'waiter.called', data: c }, c.created_at))
    for (const s of sessions.data ?? []) {
      add({
        key: `talk-${s.id}`,
        at: s.started_at,
        kind: 'talk',
        title: `${s.table_label} ${s.status === 'active' ? 'started talking' : 'had a conversation'}`,
        description: [s.language ? languageName(s.language) : null, `${s.turn_count} ${s.turn_count === 1 ? 'turn' : 'turns'}`].filter(Boolean).join(', '),
        href: `/dashboard/conversations/${s.id}`,
      })
    }
    return [...byKey.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 14)
  }, [recent, orders.data, calls.data, sessions.data])

  if (orders.isPending || sessions.isPending) {
    return (
      <div className="grid gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-14 rounded-2xl" />
        ))}
      </div>
    )
  }
  if (!items.length) {
    return <p className="py-6 text-sm text-ink-soft">Orders, waiter calls and conversations show up here as they happen.</p>
  }

  const entries: AnimatedListEntry[] = items.map((item) => {
    const Icon = ICON[item.kind]
    return {
      id: item.key,
      icon: <Icon className={item.kind === 'call' || item.kind === 'order' ? 'size-4 text-saffron-deep' : 'size-4 text-bistro'} aria-hidden />,
      title: item.title,
      description: item.description,
      meta: <span title={clockTime(item.at)}>{timeAgo(item.at)}</span>,
    }
  })

  return (
    <AnimatedList
      items={entries}
      onItemSelect={(_, index) => navigate(items[index].href)}
      theme="light"
      frame={false}
      animation="slide"
      animateOnce
      width="100%"
      maxHeight={420}
      radius={16}
      gap={6}
      fadeSize={28}
      accentColor="var(--saffron-deep)"
      displayScrollbar={false}
      style={
        {
          '--al-tile': 'var(--paper)',
          '--al-tile-edge': 'var(--line)',
          '--al-tile-highlight': 'transparent',
          '--al-tile-shadow': 'none',
          '--al-ink': 'var(--ink)',
          '--al-muted': 'var(--ink-soft)',
          '--al-well': 'var(--linen)',
        } as React.CSSProperties
      }
    />
  )
}
