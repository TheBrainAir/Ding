import {
  Armchair,
  BookOpen,
  ChefHat,
  FlaskConical,
  LayoutGrid,
  MessagesSquare,
  Settings,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
  /** Shown as the page title in the top bar. */
  title?: string
}

/** Running the room tonight. */
export const SERVICE_NAV: NavItem[] = [
  { to: '/dashboard', label: 'Overview', icon: LayoutGrid, end: true },
  { to: '/dashboard/orders', label: 'Orders', icon: ChefHat, title: 'Orders' },
  { to: '/dashboard/conversations', label: 'Conversations', icon: MessagesSquare },
  { to: '/dashboard/playground', label: 'Playground', icon: FlaskConical, title: 'Playground' },
]

/** Setting the restaurant up. */
export const SETUP_NAV: NavItem[] = [
  { to: '/dashboard/menu', label: 'Menu', icon: UtensilsCrossed },
  { to: '/dashboard/tables', label: 'Tables', icon: Armchair },
  { to: '/dashboard/knowledge', label: 'Knowledge', icon: BookOpen },
  { to: '/dashboard/settings', label: 'Settings', icon: Settings },
]

export const ALL_NAV = [...SERVICE_NAV, ...SETUP_NAV]

export function navItemFor(pathname: string): NavItem | undefined {
  // Longest matching prefix wins, so /dashboard/orders beats /dashboard.
  return [...ALL_NAV]
    .sort((a, b) => b.to.length - a.to.length)
    .find((item) => (item.end ? pathname === item.to || pathname === `${item.to}/` : pathname.startsWith(item.to)))
}
