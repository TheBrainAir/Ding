import { Link } from 'react-router'
import { Check, ChefHat, Loader2, MessagesSquare, TriangleAlert } from 'lucide-react'
import type { Order, OrderStatus } from '@/api/types'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { clockTime, formatMoney, languageName, nativeLanguageName } from '@/lib/format'
import { cn } from '@/lib/utils'
import { NEXT_STEP } from './orderSteps'
import { AllergyStrip, ElapsedChip } from './Ticket'

const STATUS_COPY: Record<OrderStatus, string> = {
  draft: 'Draft',
  placed: 'New, not started',
  preparing: 'Cooking',
  served: 'Served',
  cancelled: 'Cancelled',
}

export function OrderSheet({
  order,
  now,
  onOpenChange,
  onAdvance,
  advancing,
}: {
  order: Order | null
  now: number
  onOpenChange: (open: boolean) => void
  onAdvance: (order: Order, to: OrderStatus) => void
  advancing: boolean
}) {
  return (
    <Sheet open={!!order} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto bg-paper p-0 sm:max-w-md">
        {order && <OrderDetail order={order} now={now} onAdvance={onAdvance} advancing={advancing} />}
      </SheetContent>
    </Sheet>
  )
}

function OrderDetail({
  order,
  now,
  onAdvance,
  advancing,
}: {
  order: Order
  now: number
  onAdvance: (order: Order, to: OrderStatus) => void
  advancing: boolean
}) {
  const next = NEXT_STEP[order.status]
  const own = nativeLanguageName(order.language)
  const count = order.items.reduce((n, i) => n + i.quantity, 0)

  return (
    <div className="flex min-h-full flex-col">
      <SheetHeader className="border-b border-line px-6 py-5">
        <SheetTitle className="font-display text-xl">
          {order.table_label}, order {order.id}
        </SheetTitle>
        <SheetDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{STATUS_COPY[order.status]}</span>
          <ElapsedChip order={order} now={now} />
        </SheetDescription>
      </SheetHeader>

      <AllergyStrip order={order} large />

      <div className="grid gap-6 px-6 py-6">
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-ink-soft">Placed</dt>
            <dd className="font-medium">{clockTime(order.placed_at ?? order.created_at)}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">Guest spoke</dt>
            <dd className="font-medium">
              {languageName(order.language)}
              {own && <span className="font-normal text-ink-soft"> ({own})</span>}
            </dd>
          </div>
        </dl>

        <section aria-label="Items">
          <h3 className="font-sans text-sm font-semibold">
            {count} {count === 1 ? 'item' : 'items'}
          </h3>
          <ul className="mt-2 divide-y divide-line">
            {order.items.map((item) => (
              <li key={item.id} className={cn('flex gap-3 py-3', item.allergen_flag && 'text-paprika-deep')}>
                <span className="w-7 shrink-0 font-display font-semibold tabular">{item.quantity}×</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{item.name}</p>
                  {item.notes && <p className="text-sm text-ink-soft italic">{item.notes}</p>}
                  {item.allergen_flag && (
                    <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-paprika-soft px-2 py-0.5 text-xs font-bold">
                      <TriangleAlert className="size-3" aria-hidden />
                      Declared allergen, guest accepted the risk
                    </p>
                  )}
                </div>
                <span className="shrink-0 tabular">{formatMoney(item.price * item.quantity, order.currency)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 flex items-baseline justify-between border-t-2 border-ink pt-3 font-semibold">
            Total <span className="font-display text-lg tabular">{formatMoney(order.total, order.currency)}</span>
          </p>
        </section>

        <Button asChild variant="outline" className="justify-start">
          <Link to={`/dashboard/conversations/${order.session_id}`}>
            <MessagesSquare aria-hidden />
            Read the conversation
          </Link>
        </Button>
      </div>

      <SheetFooter className="mt-auto flex-row items-center justify-between border-t border-line px-6 py-4">
        {order.status === 'placed' || order.status === 'preparing' ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost">Cancel order</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Cancel order {order.id}?</AlertDialogTitle>
                <AlertDialogDescription>It moves to Done as cancelled. Tell the guest at {order.table_label}.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it</AlertDialogCancel>
                <AlertDialogAction onClick={() => onAdvance(order, 'cancelled')}>Cancel order</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : (
          <span />
        )}
        {next && (
          <Button variant={order.status === 'placed' ? 'accent' : 'default'} onClick={() => onAdvance(order, next.to)} disabled={advancing}>
            {advancing ? <Loader2 className="animate-spin" aria-hidden /> : next.to === 'preparing' ? <ChefHat aria-hidden /> : <Check aria-hidden />}
            {next.label}
          </Button>
        )}
      </SheetFooter>
    </div>
  )
}
