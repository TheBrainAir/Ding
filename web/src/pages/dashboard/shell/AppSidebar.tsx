import { NavLink, useLocation } from 'react-router'
import { BellRing, LogOut } from 'lucide-react'
import { BellMark } from '@/components/brand/BellMark'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import { PRODUCT_NAME } from '@/config'
import { cn } from '@/lib/utils'
import { navItemFor, SERVICE_NAV, SETUP_NAV, type NavItem } from './nav'
import { useLiveCounts } from './useShellData'

const itemClass =
  'h-9 rounded-full px-3 text-[0.94rem] text-linen/80 hover:text-paper data-[active=true]:bg-paper data-[active=true]:font-semibold data-[active=true]:text-ink [&>svg]:size-[18px] focus-visible:ring-saffron'

export function AppSidebar({ restaurantName, email, onLogout }: { restaurantName: string; email: string; onLogout: () => void }) {
  const { pathname } = useLocation()
  const active = navItemFor(pathname)
  const counts = useLiveCounts()
  const { isMobile, setOpenMobile } = useSidebar()

  const renderItem = (item: NavItem) => {
    const isActive = active?.to === item.to
    const isOrders = item.to === '/dashboard/orders'
    const attention = isOrders && (counts.placed > 0 || counts.calls > 0)
    const tooltip = isOrders && attention ? `Orders: ${counts.placed} new, ${counts.calls} waiter calls` : item.label
    return (
      <SidebarMenuItem key={item.to}>
        <SidebarMenuButton asChild isActive={isActive} tooltip={tooltip} className={itemClass}>
          <NavLink to={item.to} end={item.end} onClick={() => isMobile && setOpenMobile(false)}>
            <item.icon aria-hidden className={cn(isActive ? 'text-bistro' : 'text-linen/60')} />
            <span>{item.label}</span>
            {attention && (
              <span
                className="absolute top-1.5 left-6 hidden size-2 rounded-full bg-saffron ring-2 ring-bistro group-data-[collapsible=icon]:block"
                aria-hidden
              />
            )}
          </NavLink>
        </SidebarMenuButton>
        {isOrders && attention && (
          <SidebarMenuBadge className="right-1.5 gap-1 text-ink peer-data-[active=true]/menu-button:text-ink">
            {counts.calls > 0 && (
              <span className="inline-flex h-5 items-center gap-0.5 rounded-full bg-paper px-1.5 text-xs font-bold tabular" title="Open waiter calls">
                <BellRing className="size-3" aria-hidden />
                {counts.calls}
                <span className="sr-only"> waiter calls</span>
              </span>
            )}
            {counts.placed > 0 && (
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-saffron px-1.5 text-xs font-bold tabular" title="New orders">
                {counts.placed}
                <span className="sr-only"> new orders</span>
              </span>
            )}
          </SidebarMenuBadge>
        )}
      </SidebarMenuItem>
    )
  }

  return (
    <Sidebar collapsible="icon" className="border-r-0">
      <SidebarHeader className="px-3 pt-4 pb-2 group-data-[collapsible=icon]:px-2">
        <div className="flex items-center gap-2 px-1.5">
          <BellMark onDark className="size-7" />
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="font-display text-lg leading-tight font-semibold text-linen">{PRODUCT_NAME}</p>
            <p className="truncate text-xs text-linen/60" title={restaurantName}>
              {restaurantName}
            </p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-0 px-1">
        <SidebarGroup>
          <SidebarGroupLabel className="text-linen/50">Service</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">{SERVICE_NAV.map(renderItem)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel className="text-linen/50">Restaurant</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">{SETUP_NAV.map(renderItem)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border px-2 py-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <p className="truncate px-3 pb-1 text-xs text-linen/55 group-data-[collapsible=icon]:hidden" title={email}>
              {email}
            </p>
            <SidebarMenuButton onClick={onLogout} tooltip="Log out" className={itemClass}>
              <LogOut aria-hidden className="text-linen/60" />
              <span>Log out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
