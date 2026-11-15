import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BellRing, ExternalLink, Loader2, RotateCcw, SendHorizontal, ShieldCheck, TriangleAlert } from 'lucide-react'
import { api, turnUrl } from '@/api/client'
import { keys, useLabels } from '@/api/queries'
import type { Dish, GuestAllergies, Order, Table, TurnEvent } from '@/api/types'
import { DishPhoto } from '@/components/dish/DishPhoto'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
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

/** Things to try, in the languages guests actually speak. */
const STARTERS = [
  { lang: 'en', text: 'What do you recommend tonight?' },
  { lang: 'es', text: 'Soy alérgico a los cacahuetes. ¿Qué puedo comer?' },
  { lang: 'hy', text: 'Ի՞նչ աղանդեր ունեք։' },
  { lang: 'ja', text: 'ベジタリアン向けの料理はありますか？' },
  { lang: 'en', text: 'Can someone come to our table?' },
]

/** The same waiter the tables use, over text, without speech. */
export function WaiterChat({ persona, currency }: { persona: string; currency: string }) {
  const tables = useQuery({ queryKey: keys.tables, queryFn: api.tables })
  const [tableId, setTableId] = useState<number | null>(null)
  const table = tables.data?.find((t) => t.id === tableId) ?? tables.data?.[0] ?? null

  if (tables.isPending) return <Skeleton className="h-full min-h-[480px] rounded-[28px]" />
  if (!tables.data?.length || !table) {
    return (
      <div className="grid h-full min-h-80 place-content-center rounded-[28px] border border-dashed border-input p-8 text-center">
        <p className="font-display text-lg font-semibold">The waiter talks through a table</p>
        <p className="mt-1 text-ink-soft">Add a table first, then come back to try a conversation.</p>
        <Button asChild className="mx-auto mt-4">
          <Link to="/dashboard/tables">Add a table</Link>
        </Button>
      </div>
    )
  }
  // Remount per table so each starts from that table's own conversation.
  return <ChatForTable key={table.id} table={table} tables={tables.data} onTable={setTableId} persona={persona} currency={currency} />
}

function ChatForTable({
  table,
  tables,
  onTable,
  persona,
  currency,
}: {
  table: Table
  tables: Table[]
  onTable: (id: number) => void
  persona: string
  currency: string
}) {
  const qc = useQueryClient()
  const labels = useLabels()
  const info = useQuery({ queryKey: keys.table(table.token), queryFn: () => api.table(table.token), staleTime: 0 })
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [live, setLive] = useState<{ order: Order | null; allergies: GuestAllergies | null } | null>(null)
  const [dishes, setDishes] = useState<Dish[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const logRef = useRef<HTMLOListElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Until the first local message, show the conversation the table already has.
  const seeded: Message[] =
    info.data?.session?.transcript.map((l, i) => ({ id: -(i + 1), role: l.role, text: l.text })) ?? []
  const shown = messages ?? seeded
  const order = live ? live.order : (info.data?.session?.order ?? null)
  const allergies = live ? live.allergies : (info.data?.session?.allergies ?? null)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [shown.length, messages])

  useEffect(() => () => abortRef.current?.abort(), [])

  const send = async (raw: string) => {
    const clean = raw.trim()
    if (!clean || busy) return
    setText('')
    setBusy(true)
    const waiterId = nextId++
    setMessages((m) => [...(m ?? seeded), { id: nextId++, role: 'guest', text: clean }, { id: waiterId, role: 'waiter', text: '' }])
    const patchWaiter = (fn: (msg: Message) => Message) => setMessages((m) => (m ?? []).map((x) => (x.id === waiterId ? fn(x) : x)))
    const note = (t: string, tone?: Message['tone']) => setMessages((m) => [...(m ?? []), { id: nextId++, role: 'note', text: t, tone }])

    const abort = new AbortController()
    abortRef.current = abort
    const onEvent = (e: TurnEvent) => {
      if (e.type === 'text') patchWaiter((msg) => ({ ...msg, text: msg.text + e.delta }))
      else if (e.type === 'dishes') {
        patchWaiter((msg) => ({ ...msg, dishes: e.dishes }))
        if (e.dishes.length) setDishes(e.dishes)
      } else if (e.type === 'state') setLive({ order: e.order, allergies: e.allergies })
      else if (e.type === 'waiter_called') note(`Staff called: ${e.reason}`, 'staff')
      else if (e.type === 'error') note(e.message, 'error')
    }
    try {
      const outcome = await streamTurn(turnUrl(table.token), { kind: 'text', text: clean, speak: false }, onEvent, abort.signal)
      if (outcome === 'incomplete') note('The reply was cut off. Send it again.', 'error')
    } catch (err) {
      if (!isAbortError(err)) note((err as Error).message, 'error')
    } finally {
      setMessages((m) => (m ?? []).filter((x) => !(x.id === waiterId && !x.text && !x.dishes)))
      setBusy(false)
      abortRef.current = null
      qc.invalidateQueries({ queryKey: keys.tables })
      inputRef.current?.focus()
    }
  }

  const reset = async () => {
    abortRef.current?.abort()
    setMessages([])
    setLive({ order: null, allergies: null })
    setDishes([])
    try {
      await api.resetTable(table.token)
      qc.invalidateQueries({ queryKey: keys.tables })
      qc.invalidateQueries({ queryKey: keys.sessions })
    } catch (err) {
      setMessages([{ id: nextId++, role: 'note', text: `Could not start a new guest: ${(err as Error).message}`, tone: 'error' }])
    }
  }

  return (
    <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <section className="flex min-h-[520px] flex-col overflow-hidden rounded-[28px] border border-line bg-paper lg:min-h-0" aria-label="Conversation">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <span className="text-sm text-ink-soft">Guest at</span>
          <Select value={String(table.id)} onValueChange={(v) => onTable(Number(v))}>
            <SelectTrigger size="sm" className="w-36" aria-label="Table">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {tables.map((t) => (
                <SelectItem key={t.id} value={String(t.id)}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="ml-auto flex gap-1">
            <Button variant="ghost" size="sm" onClick={reset} disabled={busy}>
              <RotateCcw aria-hidden />
              New guest
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <a href={table.url} target="_blank" rel="noreferrer">
                <ExternalLink aria-hidden />
                Table screen
              </a>
            </Button>
          </div>
        </div>

        <ol ref={logRef} className="flex flex-1 flex-col gap-3 overflow-y-auto bg-linen/40 p-4 sm:p-5" aria-live="polite">
          {info.isPending && messages === null && <Skeleton className="h-16 w-2/3 rounded-2xl" />}
          {!info.isPending && shown.length === 0 && (
            <li className="m-auto max-w-md text-center">
              <p className="font-display text-lg font-semibold">Say something as a guest would</p>
              <p className="mt-1 text-sm text-ink-soft">Any language works. {persona} asks about allergies before taking an order.</p>
              <ul className="mt-4 flex flex-wrap justify-center gap-2">
                {STARTERS.map((s) => (
                  <li key={s.text}>
                    <button
                      type="button"
                      lang={s.lang}
                      onClick={() => void send(s.text)}
                      className="rounded-full border border-input bg-paper px-3 py-1.5 text-sm transition-colors hover:border-bistro hover:bg-sage-soft focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      {s.text}
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          )}
          {shown.map((m) =>
            m.role === 'note' ? (
              <li
                key={m.id}
                className={cn(
                  'mx-auto flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
                  m.tone === 'error' ? 'bg-linen-deep text-ink' : 'bg-saffron-soft text-ink',
                )}
              >
                {m.tone === 'staff' ? <BellRing className="size-3" aria-hidden /> : <TriangleAlert className="size-3" aria-hidden />}
                {m.text}
              </li>
            ) : (
              <li key={m.id} className={cn('flex flex-col gap-1.5', m.role === 'guest' ? 'items-end' : 'items-start')}>
                <p
                  className={cn(
                    'max-w-[82%] rounded-[18px] px-3.5 py-2 leading-relaxed',
                    m.role === 'guest' ? 'rounded-br-md bg-bistro text-paper' : 'rounded-bl-md bg-paper text-ink ring-1 ring-line',
                  )}
                >
                  {m.text || <Loader2 className="size-4 animate-spin text-ink-soft" aria-label={`${persona} is thinking`} />}
                </p>
              </li>
            ),
          )}
        </ol>

        <form
          className="flex gap-2 border-t border-line p-3"
          onSubmit={(e) => {
            e.preventDefault()
            void send(text)
          }}
        >
          <Input
            ref={inputRef}
            aria-label="Message"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`Message ${persona} as a guest`}
            autoComplete="off"
          />
          <Button type="submit" size="icon" disabled={busy || !text.trim()} aria-label="Send">
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <SendHorizontal aria-hidden />}
          </Button>
        </form>
      </section>

      <aside className="grid content-start gap-3 text-sm lg:overflow-y-auto" aria-label="What the waiter knows">
        <AllergyPanel allergies={allergies} labels={labels} />
        <div className="rounded-[20px] border border-line bg-paper p-4">
          <p className="flex justify-between font-semibold">
            Order <span className="font-normal text-ink-soft">{order ? order.status : 'none yet'}</span>
          </p>
          {order?.items.length ? (
            <ul className="mt-2 grid gap-1">
              {order.items.map((it) => (
                <li key={it.id} className={cn('flex justify-between gap-2', it.allergen_flag && 'font-semibold text-paprika')}>
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
            <p className="mt-1 text-ink-soft">Nothing ordered yet.</p>
          )}
        </div>
        {dishes.length > 0 && (
          <div className="rounded-[20px] border border-line bg-paper p-4">
            <p className="font-semibold">Just mentioned</p>
            <ul className="mt-2 grid gap-2">
              {dishes.map((d) => (
                <li key={d.id} className="flex items-center gap-3">
                  <span className="size-10 shrink-0 overflow-hidden rounded-xl">
                    <DishPhoto src={d.photo_url} name={d.name} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{d.name}</span>
                  <span className="tabular text-ink-soft">{formatMoney(d.price, currency)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </div>
  )
}

function AllergyPanel({ allergies, labels }: { allergies: GuestAllergies | null; labels: ReturnType<typeof useLabels> }) {
  if (!allergies?.confirmed) {
    return (
      <div className="rounded-[20px] border border-line bg-paper p-4">
        <p className="font-semibold">Allergies</p>
        <p className="mt-1 text-ink-soft">Not asked yet. The waiter asks before the first item goes on the order.</p>
      </div>
    )
  }
  if (!allergies.allergens.length) {
    return (
      <div className="flex items-start gap-2 rounded-[20px] bg-sage-soft p-4 text-bistro">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div>
          <p className="font-semibold">No allergies declared</p>
          {allergies.notes && <p className="mt-0.5">{allergies.notes}</p>}
        </div>
      </div>
    )
  }
  return (
    <div className="rounded-[20px] bg-paprika p-4 text-white" role="note">
      <p className="flex items-center gap-2 font-semibold">
        <TriangleAlert className="size-4 shrink-0" aria-hidden />
        Allergies: {allergies.allergens.map((a) => labels.allergen(a)).join(', ')}
      </p>
      {allergies.notes && <p className="mt-1 pl-6 text-white/90">{allergies.notes}</p>}
    </div>
  )
}
