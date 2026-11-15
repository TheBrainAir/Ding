import { Link, useLocation } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, Mic, MicOff, MonitorSmartphone, Search } from 'lucide-react'
import { api } from '@/api/client'
import type { LiveStatus } from '@/api/events'
import { keys } from '@/api/queries'
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Kbd } from '@/components/ui/kbd'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'
import { navItemFor } from './nav'
import { useShell } from './shellContext'
import { useVoiceStatus } from './useShellData'

export function Topbar({ restaurantName, extra }: { restaurantName: string; extra?: React.ReactNode }) {
  const { pathname } = useLocation()
  const item = navItemFor(pathname)
  const { live, openCommand, kitchenMode } = useShell()
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-linen/90 px-3 backdrop-blur supports-[backdrop-filter]:bg-linen/75 sm:px-5">
      {!kitchenMode && (
        <>
          <SidebarTrigger className="-ml-1 rounded-full text-ink-soft hover:bg-linen-deep hover:text-ink" aria-label="Toggle sidebar" />
          <Separator orientation="vertical" className="mr-1 !h-5" />
        </>
      )}
      <Breadcrumb className="min-w-0">
        <BreadcrumbList className="flex-nowrap">
          <BreadcrumbItem className="hidden min-w-0 md:inline-flex">
            <span className="truncate text-ink-soft">{restaurantName}</span>
          </BreadcrumbItem>
          <BreadcrumbSeparator className="hidden md:block" />
          <BreadcrumbItem>
            <BreadcrumbPage className="font-semibold text-ink">{kitchenMode ? 'Kitchen mode' : (item?.label ?? 'Dashboard')}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        {extra}
        {!kitchenMode && (
          <button
            type="button"
            onClick={openCommand}
            className="hidden h-9 items-center gap-2 rounded-full border border-input bg-paper pr-1.5 pl-3 text-sm text-ink-soft transition-colors hover:text-ink focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none lg:inline-flex"
          >
            <Search className="size-4" aria-hidden />
            Search or jump to
            <Kbd className="ml-3">{isMac ? '⌘' : 'Ctrl'} K</Kbd>
          </button>
        )}
        {!kitchenMode && (
          <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={openCommand} aria-label="Search or jump to">
            <Search aria-hidden />
          </Button>
        )}
        <LivePill status={live} />
        <VoicePill />
        {!kitchenMode && <OpenTableMenu />}
      </div>
    </header>
  )
}

function LivePill({ status }: { status: LiveStatus }) {
  const copy = { live: 'Live', connecting: 'Connecting', offline: 'Offline' }[status]
  const hint = {
    live: 'New orders and waiter calls appear as they happen.',
    connecting: 'Reconnecting to live updates…',
    offline: 'Live updates are off. Reload the page if this lasts.',
  }[status]
  return (
    <span
      role="status"
      title={hint}
      className="inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-sm text-ink-soft"
    >
      <span
        className={cn(
          'size-2 rounded-full',
          status === 'live' && 'bg-[#3f9a62] shadow-[0_0_0_3px_rgb(63_154_98/0.18)]',
          status === 'connecting' && 'animate-pulse bg-saffron',
          status === 'offline' && 'bg-ink-soft',
        )}
        aria-hidden
      />
      <span className="hidden sm:inline">{copy}</span>
      <span className="sr-only sm:hidden">{copy}</span>
    </span>
  )
}

function VoicePill() {
  const status = useVoiceStatus()
  if (status === 'loading') return null
  if (status === 'on') {
    return (
      <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-sage-soft px-3 text-sm font-medium text-bistro" title="Guests can talk out loud">
        <Mic className="size-3.5" aria-hidden />
        <span className="hidden sm:inline">Voice on</span>
        <span className="sr-only sm:hidden">Voice on</span>
      </span>
    )
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-dashed border-input bg-paper px-3 text-sm text-ink-soft transition-colors hover:text-ink focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <MicOff className="size-3.5" aria-hidden />
          <span className="hidden xl:inline">Text mode: add an ElevenLabs key to enable voice</span>
          <span className="xl:hidden">Text mode</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 rounded-2xl border-line bg-paper text-sm">
        <p className="font-semibold">The waiter is in text mode</p>
        <p className="mt-1.5 text-ink-soft">
          Guests type on the table screen and read the replies. Speech needs an ElevenLabs key: set <code className="rounded bg-linen px-1">ELEVENLABS_API_KEY</code> in{' '}
          <code className="rounded bg-linen px-1">backend/.env</code> and restart the backend.
        </p>
        <Button asChild variant="outline" size="sm" className="mt-3">
          <Link to="/dashboard/settings?tab=voice">Voice settings</Link>
        </Button>
      </PopoverContent>
    </Popover>
  )
}

function OpenTableMenu() {
  const tables = useQuery({ queryKey: keys.tables, queryFn: api.tables })
  const list = tables.data ?? []
  if (list.length === 1) {
    return (
      <Button asChild variant="accent" size="sm">
        <a href={list[0].url} target="_blank" rel="noreferrer">
          <MonitorSmartphone aria-hidden />
          <span className="hidden sm:inline">Open table screen</span>
          <span className="sr-only sm:hidden">Open table screen</span>
        </a>
      </Button>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="accent" size="sm" aria-label="Open a table screen">
          <MonitorSmartphone aria-hidden />
          <span className="hidden sm:inline">Open table screen</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 rounded-xl">
        <DropdownMenuLabel className="text-ink-soft">Opens in a new tab</DropdownMenuLabel>
        {list.map((t) => (
          <DropdownMenuItem key={t.id} asChild>
            <a href={t.url} target="_blank" rel="noreferrer" className="justify-between">
              <span>
                {t.label}
                {t.active_session_id && <span className="ml-2 text-xs text-saffron-deep">guest talking</span>}
              </span>
              <ExternalLink className="size-3.5 opacity-60" aria-hidden />
            </a>
          </DropdownMenuItem>
        ))}
        {list.length === 0 && (
          <DropdownMenuItem asChild>
            <Link to="/dashboard/tables">Add a table first</Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/dashboard/tables">Manage tables</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
