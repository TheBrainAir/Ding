import { useMe } from '@/api/queries'
import { PRODUCT_NAME } from '@/config'
import { WaiterChat } from './WaiterChat'

/** "Test the waiter": the in-browser way to talk to the same agent the tables use. */
export function PlaygroundPage() {
  const me = useMe()
  const persona = me.data?.restaurant.persona_name || PRODUCT_NAME
  const currency = me.data?.restaurant.currency ?? 'USD'
  return (
    <div className="flex h-[calc(100dvh-3.5rem-3rem)] min-h-[560px] flex-col gap-4 lg:h-[calc(100dvh-3.5rem-4rem)]">
      <header>
        <h1 className="text-[1.75rem] leading-tight font-semibold">Test the waiter</h1>
        <p className="mt-1 max-w-[70ch] text-ink-soft">
          Talk to {persona} as a guest at a real table, in text. Orders you confirm go to the kitchen screen like any other.
        </p>
      </header>
      <div className="min-h-0 flex-1">
        <WaiterChat persona={persona} currency={currency} />
      </div>
    </div>
  )
}
