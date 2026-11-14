import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { BellRing, ExternalLink, Loader2, RotateCcw, SendHorizontal, TriangleAlert } from 'lucide-react'
import { api, turnUrl } from '@/api/client'
import { keys, useLabels } from '@/api/queries'
import type { Dish, GuestAllergies, Order, TurnEvent } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatMoney } from '@/lib/format'
import { isAbortError, streamTurn } from '@/lib/voice'
import { cn } from '@/lib/utils'

interface Message {
  id: number
  role: 'guest' | 'waiter' | 'note'
  text: string
  dishes?: Dish[]
  tone?: 'error' | 'staff'
}

let nextId = 1

/** "Test the waiter": the same agent the tables use, over text, without speech. */
export function TestWaiterChat({ persona, currency }: { persona: string; currency: string }) {
  const tables = useQuery({ queryKey: keys.tables, queryFn: api.tables })
  const labels = useLabels()
  const [tableId, setTableId] = useState<number | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [order, setOrder] = useState<Order | null>(null)
  const [allergies, setAllergies] = useState<GuestAllergies | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const logRef = useRef<HTMLOListElement>(null)

  const table = tables.data?.find((t) => t.id === tableId) ?? tables.data?.[0] ?? null

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  useEffect(() => () => abortRef.current?.abort(), [])

  const send = async () => {
    const clean = text.trim()
    if (!clean || !table || busy) return
    setText('')
    setBusy(true)
    const waiterId = nextId++
    setMessages((m) => [...m, { id: nextId++, role: 'guest', text: clean }, { id: waiterId, role: 'waiter', text: '' }])
    const patchWaiter = (fn: (msg: Message) => Message) => setMessages((m) => m.map((x) => (x.id === waiterId ? fn(x) : x)))
    const note = (t: string, tone?: Message['tone']) => setMessages((m) => [...m, { id: nextId++, role: 'note', text: t, tone }])

    const abort = new AbortController()
    abortRef.current = abort
    const onEvent = (e: TurnEvent) => {
      if (e.type === 'text') patchWaiter((msg) => ({ ...msg, text: msg.text + e.delta }))
      else if (e.type === 'dishes') patchWaiter((msg) => ({ ...msg, dishes: e.dishes }))
      else if (e.type === 'state') {
        setOrder(e.order)
        setAllergies(e.allergies)
      } else if (e.type === 'waiter_called') note(`Staff called: ${e.reason}`, 'staff')
      else if (e.type === 'error') note(e.message, 'error')
    }
    try {
      const outcome = await streamTurn(turnUrl(table.token), { kind: 'text', text: clean, speak: false }, onEvent, abort.signal)
      if (outcome === 'incomplete') note('The reply was cut off.', 'error')
    } catch (err) {
      if (!isAbortError(err)) note((err as Error).message, 'error')
    } finally {
      setMessages((m) => m.filter((x) => !(x.id === waiterId && !x.text && !x.dishes)))
      setBusy(false)
      abortRef.current = null
    }
  }

  const reset = async () => {
    abortRef.current?.abort()
    setMessages([])
    setOrder(null)
    setAllergies(null)
    if (table) {
      try {
        await api.resetTable(table.token)
      } catch (err) {
        setMessages([{ id: nextId++, role: 'note', text: `Could not reset: ${(err as Error).message}`, tone: 'error' }])
      }
    }
  }

  if (tables.isPending) return <Loader2 className="size-5 animate-spin text-ink-soft" aria-label="Loading tables" />
  if (!tables.data?.length) {
    return (
      <p className="text-ink-soft">
        The waiter talks through a table.{' '}
        <Link to="/dashboard/tables" className="font-semibold text-ink underline underline-offset-4">
          Add a table
        </Link>{' '}
        first, then come back to try it.
      </p>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div className="flex min-h-[420px] flex-col rounded-[24px] border border-line bg-linen/50">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <span className="text-sm text-ink-soft">As a guest at</span>
          <Select value={String(table?.id ?? '')} onValueChange={(v) => setTableId(Number(v))}>
            <SelectTrigger size="sm" className="w-40" aria-label="Table">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {tables.data.map((t) => (
                <SelectItem key={t.id} value={String(t.id)}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="ml-auto flex gap-1">
            <Button variant="ghost" size="sm" onClick={reset}>
              <RotateCcw aria-hidden />
              New guest
            </Button>
            {table && (
              <Button variant="ghost" size="sm" asChild>
                <a href={table.url} target="_blank" rel="noreferrer">
                  <ExternalLink aria-hidden />
                  Table screen
                </a>
              </Button>
            )}
          </div>
        </div>

        <ol ref={logRef} className="flex max-h-[480px] flex-1 flex-col gap-3 overflow-y-auto p-4" aria-live="polite">
          {messages.length === 0 && (
            <li className="m-auto max-w-sm text-center text-sm text-ink-soft">
              Write the way a guest would, in any language. Try “I’d like something with peanuts” to see the allergy check.
            </li>
          )}
          {messages.map((m) =>
            m.role === 'note' ? (
              <li
                key={m.id}
                className={cn(
                  'mx-auto flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
                  m.tone === 'error' ? 'bg-paprika-soft text-paprika-deep' : 'bg-saffron-soft text-ink',
                )}
              >
                {m.tone === 'staff' ? <BellRing className="size-3" aria-hidden /> : <TriangleAlert className="size-3" aria-hidden />}
                {m.text}
              </li>
            ) : (
              <li key={m.id} className={cn('flex flex-col gap-1.5', m.role === 'guest' ? 'items-end' : 'items-start')}>
                <p
                  className={cn(
                    'max-w-[80%] rounded-[18px] px-3.5 py-2 leading-relaxed',
                    m.role === 'guest' ? 'rounded-br-md bg-bistro text-paper' : 'rounded-bl-md bg-paper text-ink ring-1 ring-line',
                  )}
                >
                  {m.text || <Loader2 className="size-4 animate-spin text-ink-soft" aria-label={`${persona} is thinking`} />}
                </p>
                {m.dishes && m.dishes.length > 0 && (
                  <ul className="flex max-w-[80%] flex-wrap gap-1">
                    {m.dishes.map((d) => (
                      <li key={d.id} className="rounded-full bg-saffron-soft px-2.5 py-0.5 text-xs font-medium">
                        {d.name}, {formatMoney(d.price, currency)}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ),
          )}
        </ol>

        <form
          className="flex gap-2 border-t border-line p-3"
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          <Input aria-label="Message" value={text} onChange={(e) => setText(e.target.value)} placeholder={`Message ${persona}`} />
          <Button type="submit" size="icon" disabled={busy || !text.trim()} aria-label="Send">
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <SendHorizontal aria-hidden />}
          </Button>
        </form>
      </div>

      <aside className="grid content-start gap-3 text-sm">
        <div className="rounded-[20px] border border-line bg-paper p-4">
          <p className="font-semibold">Allergies</p>
          <p className={cn('mt-1', allergies?.allergens.length ? 'font-semibold text-paprika' : 'text-ink-soft')}>
            {!allergies?.confirmed
              ? 'Not asked yet'
              : allergies.allergens.length
                ? allergies.allergens.map((a) => labels.allergen(a)).join(', ')
                : 'None declared'}
          </p>
          {allergies?.notes && <p className="mt-1 text-ink-soft">{allergies.notes}</p>}
        </div>
        <div className="rounded-[20px] border border-line bg-paper p-4">
          <p className="flex justify-between font-semibold">
            Order <span className="font-normal text-ink-soft">{order?.status ?? 'none'}</span>
          </p>
          {order?.items.length ? (
            <ul className="mt-2 grid gap-1">
              {order.items.map((it) => (
                <li key={it.id} className={cn('flex justify-between gap-2', it.allergen_flag && 'text-paprika')}>
                  <span>
                    {it.quantity}× {it.name}
                  </span>
                  <span className="tabular">{formatMoney(it.price * it.quantity, order.currency)}</span>
                </li>
              ))}
              <li className="mt-1 flex justify-between border-t border-line pt-1 font-semibold">
                Total <span className="tabular">{formatMoney(order.total, order.currency)}</span>
              </li>
            </ul>
          ) : (
            <p className="mt-1 text-ink-soft">Nothing yet</p>
          )}
        </div>
      </aside>
    </div>
  )
}
