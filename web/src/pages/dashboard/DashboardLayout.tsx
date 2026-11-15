import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Minimize2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, isUnauthorized } from '@/api/client'
import { useDashboardEvent, useDashboardEventStream } from '@/api/events'
import { useMe } from '@/api/queries'
import type { DashboardEvent } from '@/api/types'
import { BellMark } from '@/components/brand/BellMark'
import { Button } from '@/components/ui/button'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { useShadcnTheme } from '@/hooks/use-shadcn-theme'
import { PRODUCT_NAME } from '@/config'
import { AppSidebar } from './shell/AppSidebar'
import { CommandPalette } from './shell/CommandPalette'
import { ShellContext, type ShellState } from './shell/shellContext'
import { Topbar } from './shell/Topbar'

const KITCHEN_KEY = 'ding.kitchenMode'

function readKitchenMode() {
  try {
    return localStorage.getItem(KITCHEN_KEY) === '1'
  } catch {
    return false
  }
}

export function DashboardLayout() {
  useShadcnTheme()
  const me = useMe()
  const location = useLocation()

  if (me.isPending) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <BellMark className="size-10 animate-pulse" />
        <span className="sr-only">Loading</span>
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
        <Button variant="outline" className="mx-auto" onClick={() => me.refetch()}>
          Try again
        </Button>
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
  const [kitchenPref, setKitchenPref] = useState(readKitchenMode)
  const [commandOpen, setCommandOpen] = useState(false)
  const kitchenMode = kitchenPref && onKitchen

  useEffect(() => {
    document.title = `${restaurantName} — ${PRODUCT_NAME}`
  }, [restaurantName])

  const setKitchenMode = useCallback((on: boolean) => {
    setKitchenPref(on)
    try {
      localStorage.setItem(KITCHEN_KEY, on ? '1' : '0')
    } catch {
      /* private window */
    }
  }, [])

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

  const shell = useMemo<ShellState>(
    () => ({ live, kitchenMode, setKitchenMode, openCommand: () => setCommandOpen(true) }),
    [live, kitchenMode, setKitchenMode],
  )

  return (
    <ShellContext.Provider value={shell}>
      <SidebarProvider>
        {!kitchenMode && <AppSidebar restaurantName={restaurantName} email={email} onLogout={() => logout.mutate()} />}
        <SidebarInset className="min-w-0 bg-background">
          <Topbar
            restaurantName={restaurantName}
            extra={
              kitchenMode ? (
                <Button variant="outline" size="sm" onClick={() => setKitchenMode(false)}>
                  <Minimize2 aria-hidden />
                  Exit kitchen mode
                </Button>
              ) : null
            }
          />
          <div className="flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
            <div className={kitchenMode ? '' : 'mx-auto max-w-[1320px]'}>
              <Outlet />
            </div>
          </div>
        </SidebarInset>
        <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
        {logout.isPending && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-linen/70">
            <Loader2 className="size-6 animate-spin text-ink-soft" aria-label="Logging out" />
          </div>
        )}
      </SidebarProvider>
    </ShellContext.Provider>
  )
}
