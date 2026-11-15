import { NavLink, useLocation } from 'react-router'
import { BellRing, LogOut } from 'lucide-react'
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
import { navItemFor, SERVICE_NAV, SETUP_NAV, type NavItem } from './nav'
import { useLiveCounts } from './useShellData'

const itemClass = 'data-[active=true]:font-medium'

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
            <item.icon aria-hidden />
            <span>{item.label}</span>
            {attention && (
              <span
                className="absolute top-1 left-5 hidden size-2 rounded-full bg-saffron ring-2 ring-sidebar group-data-[collapsible=icon]:block"
                aria-hidden
              />
            )}
          </NavLink>
        </SidebarMenuButton>
        {isOrders && attention && (
          <SidebarMenuBadge className="right-1 gap-1">
            {counts.calls > 0 && (
              <span className="inline-flex h-5 items-center gap-0.5 rounded-md border border-sidebar-border bg-background px-1.5 text-xs font-medium tabular" title="Open waiter calls">
                <BellRing className="size-3" aria-hidden />
                {counts.calls}
                <span className="sr-only"> waiter calls</span>
              </span>
            )}
            {counts.placed > 0 && (
              <span className="grid h-5 min-w-5 place-items-center rounded-md bg-saffron px-1.5 text-xs font-semibold text-black tabular" title="New orders">
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
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 p-1">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground"><BellRing className="size-4" aria-hidden /></span>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="text-sm leading-tight font-semibold">{PRODUCT_NAME}</p>
            <p className="truncate text-xs text-muted-foreground" title={restaurantName}>
              {restaurantName}
            </p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Service</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{SERVICE_NAV.map(renderItem)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Restaurant</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{SETUP_NAV.map(renderItem)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <p className="truncate px-2 pb-1 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden" title={email}>
              {email}
            </p>
            <SidebarMenuButton onClick={onLogout} tooltip="Log out" className={itemClass}>
              <LogOut aria-hidden />
              <span>Log out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
