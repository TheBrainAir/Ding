import { useEffect } from 'react'

/**
 * Puts the stock shadcn theme on <html> while the calling route is mounted. It has to be the
 * root element: dialogs, sheets and popovers render in portals outside any wrapper.
 */
export function useShadcnTheme() {
  useEffect(() => {
    const root = document.documentElement
    root.classList.add('theme-shadcn')
    return () => root.classList.remove('theme-shadcn')
  }, [])
}
