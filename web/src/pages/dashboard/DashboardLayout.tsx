import { useCallback, useEffect } from 'react'
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BookOpen,
  ChefHat,
  LayoutGrid,
  Loader2,
  LogOut,
  MessagesSquare,
  QrCode,
  Settings,
  UtensilsCrossed,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, isUnauthorized } from '@/api/client'
import { useDashboardEvent, useDashboardEventStream, type LiveStatus } from '@/api/events'
import { keys, useMe } from '@/api/queries'
import type { DashboardEvent } from '@/api/types'
import { Wordmark } from '@/components/brand/BellMark'
import { PRODUCT_NAME } from '@/config'
import { cn } from '@/lib/utils'

const NAV = [
  { to: '/dashboard', label: 'Overview', icon: LayoutGrid, end: true },
  { to: '/dashboard/orders', label: 'Orders', icon: ChefHat },
  { to: '/dashboard/menu', label: 'Menu', icon: UtensilsCrossed },
  { to: '/dashboard/tables', label: 'Tables', icon: QrCode },
  { to: '/dashboard/conversations', label: 'Conversations', icon: MessagesSquare },
  { to: '/dashboard/knowledge', label: 'Knowledge', icon: BookOpen },
  { to: '/dashboard/settings', label: 'Settings', icon: Settings },
]

export function DashboardLayout() {
  const me = useMe()
  const location = useLocation()

  if (me.isPending) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Loader2 className="size-7 animate-spin text-ink-soft" aria-label="Loading" />
      </div>
    )
  }
  if (me.isError) {
    if (isUnauthorized(me.error)) {
      const next = encodeURIComponent(location.pathname + location.search)
      return <Navigate to={`/login?next=${next}`} replace />
    }
    return (
      <div className="grid min-h-dvh place-content-center gap-3 px-6 text-center">
        <h1 className="text-2xl">Cannot reach the server</h1>
        <p className="text-ink-soft">{me.error.message}. Check that the backend is running on port 8010.</p>
        <button className="mx-auto font-semibold underline underline-offset-4" onClick={() => me.refetch()}>
          Try again
        </button>
      </div>
    )
  }
  return <SignedInShell restaurantName={me.data.restaurant.name} email={me.data.user.email} />
}

function SignedInShell({ restaurantName, email }: { restaurantName: string; email: string }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const live = useDashboardEventStream(qc, true)
  const onKitchen = location.pathname.startsWith('/dashboard/orders')

  const orders = useQuery({ queryKey: keys.orders, queryFn: () => api.orders() })
  const calls = useQuery({ queryKey: keys.waiterCalls, queryFn: () => api.waiterCalls(false) })
  const waiting = (orders.data?.filter((o) => o.status === 'placed').length ?? 0) + (calls.data?.filter((c) => !c.resolved).length ?? 0)

  useEffect(() => {
    document.title = `${restaurantName} — ${PRODUCT_NAME}`
  }, [restaurantName])

  // Away from the kitchen screen, surface live events as toasts.
  const onEvent = useCallback(
    (event: DashboardEvent) => {
      if (onKitchen) return
      if (event.type === 'order.placed') {
        toast(`New order from ${event.data.table_label}`, {
          description: event.data.allergies.length ? 'Allergies declared. Check the ticket.' : undefined,
          action: { label: 'Open orders', onClick: () => navigate('/dashboard/orders') },
        })
      } else if (event.type === 'waiter.called') {
        toast(`${event.data.table_label} asked for a person`, {
          description: event.data.reason,
          action: { label: 'Open orders', onClick: () => navigate('/dashboard/orders') },
        })
      }
    },
    [onKitchen, navigate],
  )
  useDashboardEvent(onEvent)

  const logout = useMutation({
    mutationFn: api.logout,
    onSettled: () => {
      qc.clear()
      navigate('/login', { replace: true })
    },
  })

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="flex flex-col bg-bistro text-linen lg:sticky lg:top-0 lg:h-dvh">
        <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3 lg:block lg:px-6 lg:pt-7">
          <Wordmark onDark />
          <p className="truncate text-sm text-linen/65 lg:mt-3" title={restaurantName}>
            {restaurantName}
          </p>
        </div>

        <nav aria-label="Dashboard" className="overflow-x-auto px-3 pb-3 lg:mt-4 lg:flex-1 lg:overflow-visible lg:pb-0">
          <ul className="flex gap-1 lg:flex-col">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    cn(
                      'group flex items-center gap-3 rounded-full px-3.5 py-2 text-[0.95rem] whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-saffron focus-visible:outline-none',
                      isActive ? 'bg-paper font-semibold text-ink' : 'text-linen/80 hover:bg-white/8 hover:text-linen',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon className={cn('size-[18px]', isActive ? 'text-bistro' : 'text-linen/60 group-hover:text-linen')} aria-hidden />
                      {label}
                      {to === '/dashboard/orders' && waiting > 0 && (
                        <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-saffron px-1.5 text-xs font-bold text-ink tabular">
                          {waiting}
                        </span>
                      )}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="hidden border-t border-white/10 px-6 py-4 text-sm lg:block">
          <LiveIndicator status={live} />
          <p className="mt-3 truncate text-linen/60" title={email}>
            {email}
          </p>
          <button
            type="button"
            onClick={() => logout.mutate()}
            className="mt-2 inline-flex items-center gap-2 rounded-full text-linen/80 hover:text-linen focus-visible:ring-2 focus-visible:ring-saffron focus-visible:outline-none"
          >
            <LogOut className="size-4" aria-hidden />
            Log out
          </button>
        </div>
      </aside>

      <main className="min-w-0 px-5 py-7 sm:px-8 lg:px-12 lg:py-10">
        <div className="mx-auto max-w-[1280px]">
          <Outlet />
        </div>
        <div className="mt-12 flex items-center justify-between border-t border-line pt-4 text-sm text-ink-soft lg:hidden">
          <LiveIndicator status={live} dark />
          <button type="button" onClick={() => logout.mutate()} className="inline-flex items-center gap-2">
            <LogOut className="size-4" aria-hidden />
            Log out
          </button>
        </div>
      </main>
    </div>
  )
}

function LiveIndicator({ status, dark = false }: { status: LiveStatus; dark?: boolean }) {
  const copy = { live: 'Live updates on', connecting: 'Connecting…', offline: 'Live updates off' }[status]
  return (
    <p className={cn('flex items-center gap-2', dark ? 'text-ink-soft' : 'text-linen/75')} role="status">
      <span
        className={cn(
          'size-2 rounded-full',
          status === 'live' && 'bg-[#7fd99a] shadow-[0_0_0_3px_rgb(127_217_154/0.25)]',
          status === 'connecting' && 'animate-pulse bg-saffron',
          status === 'offline' && 'bg-paprika',
        )}
        aria-hidden
      />
      {copy}
    </p>
  )
}
