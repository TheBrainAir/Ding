import { useState } from 'react'
import { CircleAlert, Pencil } from 'lucide-react'
import type { Dish } from '@/api/types'
import { useLabels } from '@/api/queries'
import { DishPhoto } from '@/components/dish/DishPhoto'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatMoney } from '@/lib/format'
import { cn } from '@/lib/utils'
import { dishFlags } from './dishFlags'

/** Dense list for quick edits: availability and price change in place. */
export function DishTable({
  dishes,
  currency,
  onEdit,
  onToggle,
  onPrice,
}: {
  dishes: Dish[]
  currency: string
  onEdit: (dish: Dish) => void
  onToggle: (dish: Dish, available: boolean) => void
  onPrice: (dish: Dish, price: number) => void
}) {
  const labels = useLabels()
  return (
    <div className="overflow-hidden rounded-[24px] border border-line bg-paper">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-14 pl-4">
              <span className="sr-only">Photo</span>
            </TableHead>
            <TableHead>Dish</TableHead>
            <TableHead className="hidden md:table-cell">Category</TableHead>
            <TableHead className="hidden lg:table-cell">Allergens</TableHead>
            <TableHead className="w-32">Price</TableHead>
            <TableHead className="w-28">Available</TableHead>
            <TableHead className="w-12 pr-4">
              <span className="sr-only">Edit</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {dishes.map((d) => {
            const flags = dishFlags(d)
            return (
              <TableRow key={d.id} className={cn(!d.available && 'text-ink-soft')}>
                <TableCell className="pl-4">
                  <span className="block size-10 overflow-hidden rounded-xl">
                    <DishPhoto src={d.photo_url} name={d.name} className={cn(!d.available && 'grayscale')} />
                  </span>
                </TableCell>
                <TableCell className="max-w-[16rem]">
                  <button type="button" onClick={() => onEdit(d)} className="block truncate text-left font-medium hover:underline focus-visible:underline focus-visible:outline-none">
                    {d.name}
                  </button>
                  {flags.length > 0 && (
                    <span className="mt-0.5 flex items-center gap-1 text-xs text-ink-soft">
                      <CircleAlert className="size-3" aria-hidden />
                      {flags.join(', ')}
                    </span>
                  )}
                </TableCell>
                <TableCell className="hidden md:table-cell">{d.category}</TableCell>
                <TableCell className="hidden max-w-[18rem] truncate lg:table-cell">
                  {d.allergens.length ? d.allergens.map((a) => labels.allergen(a)).join(', ') : <span className="text-ink-soft">None listed</span>}
                </TableCell>
                <TableCell>
                  <PriceCell dish={d} currency={currency} onPrice={onPrice} />
                </TableCell>
                <TableCell>
                  <Switch checked={d.available} onCheckedChange={(v) => onToggle(d, v)} aria-label={`${d.name} available`} />
                </TableCell>
                <TableCell className="pr-4">
                  <Button variant="ghost" size="icon-sm" onClick={() => onEdit(d)} aria-label={`Edit ${d.name}`}>
                    <Pencil aria-hidden />
                  </Button>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function PriceCell({ dish, currency, onPrice }: { dish: Dish; currency: string; onPrice: (dish: Dish, price: number) => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(String(dish.price))

  const commit = () => {
    setEditing(false)
    const next = Number(value.replace(',', '.'))
    if (!Number.isNaN(next) && next >= 0 && next !== dish.price) onPrice(dish, next)
    else setValue(String(dish.price))
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setValue(String(dish.price))
          setEditing(true)
        }}
        className="rounded-md px-1.5 py-1 font-display text-sm font-semibold tabular hover:bg-linen focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        aria-label={`Price of ${dish.name}: ${formatMoney(dish.price, currency)}. Click to change.`}
      >
        {formatMoney(dish.price, currency)}
      </button>
    )
  }
  return (
    <Input
      autoFocus
      inputMode="decimal"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') {
          setValue(String(dish.price))
          setEditing(false)
        }
      }}
      className="h-8 w-24 text-sm"
      aria-label={`New price for ${dish.name}`}
    />
  )
}
