import { createContext, useContext } from 'react'
import type { LiveStatus } from '@/api/events'

export interface ShellState {
  live: LiveStatus
  /** Orders page only: hides the sidebar and enlarges tickets for a wall-mounted screen. */
  kitchenMode: boolean
  setKitchenMode: (on: boolean) => void
  openCommand: () => void
}

export const ShellContext = createContext<ShellState>({
  live: 'connecting',
  kitchenMode: false,
  setKitchenMode: () => {},
  openCommand: () => {},
})

export function useShell() {
  return useContext(ShellContext)
}
