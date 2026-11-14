import { createBrowserRouter, Navigate, Outlet } from 'react-router'
import { LoadingScreen } from '@/components/LoadingScreen'
import { NotFoundPage } from '@/pages/NotFoundPage'

// Every screen is its own chunk: the guest table screen never downloads the dashboard.
export const router = createBrowserRouter([
  {
    element: <Outlet />,
    HydrateFallback: LoadingScreen,
    children: [
      { path: '/', element: <Navigate to="/dashboard" replace /> },
      { path: '/login', lazy: () => import('@/pages/auth/AuthPages').then((m) => ({ Component: m.LoginPage })) },
      { path: '/signup', lazy: () => import('@/pages/auth/AuthPages').then((m) => ({ Component: m.SignupPage })) },
      {
        path: '/dashboard',
        lazy: () => import('@/pages/dashboard/DashboardLayout').then((m) => ({ Component: m.DashboardLayout })),
        children: [
          { index: true, lazy: () => import('@/pages/dashboard/OverviewPage').then((m) => ({ Component: m.OverviewPage })) },
          { path: 'menu', lazy: () => import('@/pages/dashboard/menu/MenuPage').then((m) => ({ Component: m.MenuPage })) },
          { path: 'knowledge', lazy: () => import('@/pages/dashboard/KnowledgePage').then((m) => ({ Component: m.KnowledgePage })) },
          { path: 'tables', lazy: () => import('@/pages/dashboard/TablesPage').then((m) => ({ Component: m.TablesPage })) },
          { path: 'orders', lazy: () => import('@/pages/dashboard/OrdersPage').then((m) => ({ Component: m.OrdersPage })) },
          {
            path: 'conversations',
            lazy: () => import('@/pages/dashboard/ConversationsPage').then((m) => ({ Component: m.ConversationsPage })),
          },
          {
            path: 'conversations/:sessionId',
            lazy: () => import('@/pages/dashboard/ConversationsPage').then((m) => ({ Component: m.ConversationsPage })),
          },
          { path: 'settings', lazy: () => import('@/pages/dashboard/settings/SettingsPage').then((m) => ({ Component: m.SettingsPage })) },
        ],
      },
      { path: '/t/:token', lazy: () => import('@/pages/table/TablePage').then((m) => ({ Component: m.TablePage })) },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
