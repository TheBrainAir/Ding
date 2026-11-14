import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileUp, Plus, Search, UtensilsCrossed } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { keys, useLabels, useMe } from '@/api/queries'
import type { Dish } from '@/api/types'
import { AllergenChips } from '@/components/AllergenChips'
import { DishPhoto } from '@/components/dish/DishPhoto'
import { EmptyState, PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { formatMoney } from '@/lib/format'
import { cn } from '@/lib/utils'
import { DishFormSheet } from './DishForm'
import { ImportMenuDialog } from './ImportMenuDialog'

export function MenuPage() {
  const me = useMe()
  const currency = me.data?.restaurant.currency ?? 'USD'
  const dishes = useQuery({ queryKey: keys.dishes, queryFn: () => api.dishes() })
  const [q, setQ] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [editing, setEditing] = useState<Dish | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  const categories = useMemo(() => [...new Set((dishes.data ?? []).map((d) => d.category).filter(Boolean))].sort(), [dishes.data])

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (dishes.data ?? []).filter((d) => {
      if (category && d.category !== category) return false
      if (!needle) return true
      return [d.name, d.description, d.category, ...d.ingredients].some((s) => s?.toLowerCase().includes(needle))
    })
  }, [dishes.data, q, category])

  const openNew = () => {
    setEditing(null)
    setFormOpen(true)
  }
  const openEdit = (dish: Dish) => {
    setEditing(dish)
    setFormOpen(true)
  }

  return (
    <>
      <PageHeader
        title="Menu"
        description="Everything the waiter can offer. Allergens and ingredients here are the only facts it repeats to guests."
        actions={
          <>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <FileUp aria-hidden />
              Import from photo or PDF
            </Button>
            <Button onClick={openNew}>
              <Plus aria-hidden />
              Add dish
            </Button>
          </>
        }
      />

      {dishes.isPending ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-80 rounded-[28px]" />
          ))}
        </div>
      ) : dishes.isError ? (
        <p className="text-paprika">Could not load the menu: {dishes.error.message}</p>
      ) : dishes.data.length === 0 ? (
        <EmptyState
          icon={<UtensilsCrossed />}
          title="Your menu is empty"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={openNew}>
                <Plus aria-hidden />
                Add the first dish
              </Button>
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <FileUp aria-hidden />
                Import a printed menu
              </Button>
            </div>
          }
        >
          Add dishes one by one, or import a photo of your printed menu and check what AI read from it.
        </EmptyState>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-soft" aria-hidden />
              <Input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search dishes or ingredients"
                className="pl-9"
                aria-label="Search dishes"
              />
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by category">
              <CategoryPill active={category === null} onClick={() => setCategory(null)}>
                All <span className="text-current/60 tabular">{dishes.data.length}</span>
              </CategoryPill>
              {categories.map((c) => (
                <CategoryPill key={c} active={category === c} onClick={() => setCategory(category === c ? null : c)}>
                  {c}
                </CategoryPill>
              ))}
            </div>
          </div>

          {visible.length === 0 ? (
            <p className="py-16 text-center text-ink-soft">No dishes match. Clear the search or pick another category.</p>
          ) : (
            <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((dish) => (
                <DishCard key={dish.id} dish={dish} currency={currency} onEdit={() => openEdit(dish)} />
              ))}
            </ul>
          )}
        </>
      )}

      <DishFormSheet open={formOpen} onOpenChange={setFormOpen} dish={editing} categories={categories} />
      <ImportMenuDialog open={importOpen} onOpenChange={setImportOpen} />
    </>
  )
}

function CategoryPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
        active ? 'border-bistro bg-bistro text-paper' : 'border-input bg-paper text-ink hover:bg-linen-deep',
      )}
    >
      {children}
    </button>
  )
}

function DishCard({ dish, currency, onEdit }: { dish: Dish; currency: string; onEdit: () => void }) {
  const qc = useQueryClient()
  const labels = useLabels()
  const toggle = useMutation({
    mutationFn: (available: boolean) => api.updateDish(dish.id, { available }),
    onMutate: async (available) => {
      await qc.cancelQueries({ queryKey: keys.dishes })
      const prev = qc.getQueryData<Dish[]>(keys.dishes)
      qc.setQueryData<Dish[]>(keys.dishes, (list) => list?.map((d) => (d.id === dish.id ? { ...d, available } : d)))
      return { prev }
    },
    onError: (err: Error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.dishes, ctx.prev)
      toast.error(`Could not update ${dish.name}`, { description: err.message })
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.dishes }),
  })

  return (
    <li className={cn('group flex flex-col overflow-hidden rounded-[28px] border border-line bg-paper transition-shadow hover:shadow-[0_18px_40px_-28px_rgb(23_54_42/0.45)]', !dish.available && 'opacity-70')}>
      <button type="button" onClick={onEdit} className="relative aspect-[4/3] overflow-hidden text-left focus-visible:outline-none" aria-label={`Edit ${dish.name}`}>
        <DishPhoto src={dish.photo_url} name={dish.name} className={cn(!dish.available && 'grayscale')} />
        <span className="absolute top-3 left-3 rounded-full bg-paper/95 px-2.5 py-1 text-xs font-medium text-ink">{dish.category}</span>
        {!dish.available && (
          <span className="absolute top-3 right-3 rounded-full bg-ink px-2.5 py-1 text-xs font-semibold text-paper">Off today</span>
        )}
      </button>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <button type="button" onClick={onEdit} className="min-w-0 text-left font-semibold hover:underline focus-visible:underline focus-visible:outline-none">
            <span className="line-clamp-1">{dish.name}</span>
          </button>
          <span className="shrink-0 font-display text-sm font-semibold tabular">{formatMoney(dish.price, currency)}</span>
        </div>
        {dish.description && <p className="line-clamp-2 text-sm text-ink-soft">{dish.description}</p>}
        <AllergenChips allergens={dish.allergens} mayContain={dish.may_contain} />
        {dish.dietary_tags.length > 0 && (
          <p className="text-xs text-bistro">{dish.dietary_tags.map((t) => labels.tag(t)).join(', ')}</p>
        )}
        <label className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-3 text-sm">
          <span className={dish.available ? 'text-ink' : 'text-ink-soft'}>{dish.available ? 'Available' : 'Unavailable'}</span>
          <Switch
            checked={dish.available}
            onCheckedChange={(v) => toggle.mutate(v)}
            aria-label={`${dish.name} available`}
          />
        </label>
      </div>
    </li>
  )
}
