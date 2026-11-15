import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import { keys } from '@/api/queries'

/** Counts that drive the nav badges. Both lists stay fresh through the SSE stream. */
export function useLiveCounts() {
  const orders = useQuery({ queryKey: keys.orders, queryFn: () => api.orders() })
  const calls = useQuery({ queryKey: keys.waiterCalls, queryFn: () => api.waiterCalls(false) })
  return {
    placed: orders.data?.filter((o) => o.status === 'placed').length ?? 0,
    calls: calls.data?.filter((c) => !c.resolved).length ?? 0,
  }
}

export type VoiceStatus = 'loading' | 'on' | 'off'

/**
 * Whether guests can talk out loud. The dashboard API has no field for it, so this asks the
 * public table endpoint (its `voice_enabled` is false without an ElevenLabs key) and falls back
 * to the voice list, which is empty without a key.
 */
export function useVoiceStatus(): VoiceStatus {
  const tables = useQuery({ queryKey: keys.tables, queryFn: api.tables })
  const token = tables.data?.[0]?.token
  const table = useQuery({
    queryKey: keys.table(token ?? ''),
    queryFn: () => api.table(token!),
    enabled: !!token,
    staleTime: 60_000,
  })
  const voices = useQuery({ queryKey: keys.voices, queryFn: api.voices, staleTime: 5 * 60_000, enabled: tables.isSuccess && !token })

  if (table.data) return table.data.voice_enabled ? 'on' : 'off'
  if (voices.data) return voices.data.length > 0 ? 'on' : 'off'
  return 'loading'
}
