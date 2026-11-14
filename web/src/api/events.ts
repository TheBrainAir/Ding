import { useEffect, useState } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { EVENTS_URL } from './client'
import { keys } from './queries'
import type { DashboardEvent, Order, SessionSummary, WaiterCall } from './types'

type Listener = (event: DashboardEvent) => void
const listeners = new Set<Listener>()

/** Subscribe to live dashboard events (the stream itself is owned by the layout). */
export function subscribeDashboardEvents(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useDashboardEvent(listener: Listener) {
  useEffect(() => subscribeDashboardEvents(listener), [listener])
}

function upsertById<T extends { id: number }>(list: T[] | undefined, item: T, prepend = true): T[] | undefined {
  if (!list) return list
  const idx = list.findIndex((x) => x.id === item.id)
  if (idx === -1) return prepend ? [item, ...list] : [...list, item]
  const next = list.slice()
  next[idx] = item
  return next
}

/** Keeps react-query caches in step with what the server pushes. */
export function applyEventToCache(qc: QueryClient, event: DashboardEvent) {
  switch (event.type) {
    case 'order.placed':
    case 'order.updated': {
      const order = event.data as Order
      qc.setQueryData<Order[]>(keys.orders, (list) => upsertById(list, order))
      qc.invalidateQueries({ queryKey: keys.stats })
      qc.invalidateQueries({ queryKey: keys.session(order.session_id) })
      break
    }
    case 'waiter.called': {
      const call = event.data as WaiterCall
      qc.setQueryData<WaiterCall[]>(keys.waiterCalls, (list) => upsertById(list, call))
      qc.invalidateQueries({ queryKey: keys.stats })
      break
    }
    case 'session.updated': {
      const session = event.data as SessionSummary
      qc.setQueryData<SessionSummary[]>(keys.sessions, (list) => upsertById(list, session))
      qc.invalidateQueries({ queryKey: keys.session(session.id), exact: true })
      qc.invalidateQueries({ queryKey: keys.tables })
      qc.invalidateQueries({ queryKey: keys.stats })
      break
    }
  }
}

const EVENT_NAMES: DashboardEvent['type'][] = ['order.placed', 'order.updated', 'waiter.called', 'session.updated']

export type LiveStatus = 'connecting' | 'live' | 'offline'

/**
 * Opens the single EventSource for the dashboard. EventSource reconnects by
 * itself; after a reconnect we refetch so nothing missed while offline is lost.
 */
export function useDashboardEventStream(qc: QueryClient, enabled: boolean): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>('connecting')

  useEffect(() => {
    if (!enabled) return
    const source = new EventSource(EVENTS_URL, { withCredentials: true })
    let wasOffline = false

    source.onopen = () => {
      setStatus('live')
      if (wasOffline) {
        wasOffline = false
        qc.invalidateQueries({ queryKey: keys.orders })
        qc.invalidateQueries({ queryKey: keys.waiterCalls })
        qc.invalidateQueries({ queryKey: keys.sessions })
        qc.invalidateQueries({ queryKey: keys.stats })
      }
    }
    source.onerror = () => {
      wasOffline = true
      setStatus(source.readyState === EventSource.CLOSED ? 'offline' : 'connecting')
    }

    const handlers = EVENT_NAMES.map((name) => {
      const handler = (msg: MessageEvent<string>) => {
        let data: unknown
        try {
          data = JSON.parse(msg.data)
        } catch {
          return
        }
        const event = { type: name, data } as DashboardEvent
        applyEventToCache(qc, event)
        for (const listener of listeners) listener(event)
      }
      source.addEventListener(name, handler)
      return [name, handler] as const
    })

    return () => {
      for (const [name, handler] of handlers) source.removeEventListener(name, handler)
      source.close()
    }
  }, [qc, enabled])

  return status
}
