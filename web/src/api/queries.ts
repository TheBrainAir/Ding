import { QueryClient, useQuery, type QueryKey } from '@tanstack/react-query'
import { api, isUnauthorized } from './client'
import type { Allergen, DietaryTag, Meta } from './types'
import { humanize } from '@/lib/format'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => !isUnauthorized(err) && count < 2,
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
})

export const keys = {
  me: ['me'] as QueryKey,
  meta: ['meta'] as QueryKey,
  restaurant: ['restaurant'] as QueryKey,
  voices: ['voices'] as QueryKey,
  models: ['models'] as QueryKey,
  dishes: ['dishes'] as QueryKey,
  knowledge: ['knowledge'] as QueryKey,
  tables: ['tables'] as QueryKey,
  orders: ['orders'] as QueryKey,
  waiterCalls: ['waiter-calls'] as QueryKey,
  sessions: ['sessions'] as QueryKey,
  session: (id: number) => ['sessions', id] as QueryKey,
  stats: ['stats'] as QueryKey,
  table: (token: string) => ['table', token] as QueryKey,
}

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: api.me, retry: false, staleTime: 60_000 })
}

export function useMeta() {
  return useQuery({ queryKey: keys.meta, queryFn: api.meta, staleTime: Infinity })
}

/** Label lookups backed by /api/meta, with a readable fallback while it loads. */
export function useLabels() {
  const { data } = useMeta()
  return makeLabels(data)
}

export function makeLabels(meta: Meta | undefined) {
  const allergen = new Map(meta?.allergens.map((a) => [a.id, a.label]))
  const tag = new Map(meta?.dietary_tags.map((t) => [t.id, t.label]))
  return {
    allergen: (id: Allergen | string) => allergen.get(id as Allergen) ?? humanize(id),
    tag: (id: DietaryTag | string) => tag.get(id as DietaryTag) ?? humanize(id),
  }
}
