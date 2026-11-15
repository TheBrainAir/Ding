import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileUp, LayoutGrid, List, Plus, Search, ShieldCheck, UtensilsCrossed, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { keys, useLabels, useMe, useMeta } from '@/api/queries'
import type { Allergen, Dish, DishInput } from '@/api/types'
import { EmptyState, PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { DishCard } from './DishCard'
import { dishFlags, isFreeOf } from './dishFlags'
import { DishSheet } from './DishSheet'
import { DishTable } from './DishTable'
import { ImportMenuDialog } from './ImportMenuDialog'

type View = 'grid' | 'list'
type Availability = 'all' | 'available' | 'off' | 'incomplete'
const VIEW_KEY = 'ding.menu.view'

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

export function MenuPage() {
  const qc = useQueryClient()
  const me = useMe()
  const meta = useMeta()
  const labels = useLabels()
  const currency = me.data?.restaurant.currency ?? 'USD'
  const dishes = useQuery({ queryKey: keys.dishes, queryFn: () => api.dishes() })
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [availability, setAvailability] = useState<Availability>('all')
  const [freeOf, setFreeOf] = useState<Allergen[]>([])
  const [view, setView] = useState<View>(readView)
  const [editing, setEditing] = useState<Dish | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  // Deep links from the command palette: ?new=1, ?import=1, ?dish=<id>.
  const newParam = params.get('new') === '1'
  const importParam = params.get('import') === '1'
  const dishParam = params.get('dish')
  const deepDish = dishParam ? dishes.data?.find((d) => d.id === Number(dishParam)) : undefined
  const sheetOpen = formOpen || newParam || !!deepDish
  const sheetDish = newParam ? null : (deepDish ?? editing)
  const clearDeepLink = () => {
    if (newParam || importParam || dishParam) setParams({}, { replace: true })
  }

  const all = useMemo(() => dishes.data ?? [], [dishes.data])
  const categories = useMemo(() => [...new Set(all.map((d) => d.category).filter(Boolean))].sort(), [all])
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of all) m.set(d.category, (m.get(d.category) ?? 0) + 1)
    return m
  }, [all])

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return all.filter((d) => {
      if (category && d.category !== category) return false
      if (availability === 'available' && !d.available) return false
      if (availability === 'off' && d.available) return false
      if (availability === 'incomplete' && !dishFlags(d).length) return false
      if (!isFreeOf(d, freeOf)) return false
      if (!needle) return true
      return [d.name, d.description, d.category, ...d.ingredients].some((s) => s?.toLowerCase().includes(needle))
    })
  }, [all, q, category, availability, freeOf])

  const patchDish = useMutation({
    mutationFn: ({ dish, body }: { dish: Dish; body: Partial<DishInput> }) => api.updateDish(dish.id, body),
    onMutate: async ({ dish, body }) => {
      await qc.cancelQueries({ queryKey: keys.dishes })
      const prev = qc.getQueryData<Dish[]>(keys.dishes)
      qc.setQueryData<Dish[]>(keys.dishes, (list) => list?.map((d) => (d.id === dish.id ? { ...d, ...body } : d)))
      return { prev }
    },
    onError: (err: Error, { dish }, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.dishes, ctx.prev)
      toast.error(`Could not update ${dish.name}`, { description: err.message })
    },
    onSuccess: (saved, { body }) => {
      if (body.price !== undefined) toast(`${saved.name} now costs ${saved.price}`)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.dishes }),
  })

  const setViewRemembered = (v: View) => {
    setView(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      /* private window */
    }
  }

  const openNew = () => {
    clearDeepLink()
    setEditing(null)
    setFormOpen(true)
  }
  const openEdit = (dish: Dish) => {
    clearDeepLink()
    setEditing(dish)
    setFormOpen(true)
  }
  const incomplete = all.filter((d) => dishFlags(d).length).length
  const filtered = q || category || availability !== 'all' || freeOf.length > 0
  const clearFilters = () => {
    setQ('')
    setCategory(null)
    setAvailability('all')
    setFreeOf([])
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
        <div className="rounded-[28px] border border-line bg-paper p-6">
          <p>Could not load the menu: {dishes.error.message}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => dishes.refetch()}>
            Try again
          </Button>
        </div>
      ) : all.length === 0 ? (
        <EmptyState
          icon={<UtensilsCrossed />}
          title="Your menu is empty"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => setImportOpen(true)}>
                <FileUp aria-hidden />
                Import a printed menu
              </Button>
              <Button variant="outline" onClick={openNew}>
                <Plus aria-hidden />
                Add a dish by hand
              </Button>
            </div>
          }
        >
          The fastest start: a photo of your printed menu. AI reads it and you check each dish before it is saved.
        </EmptyState>
      ) : (
        <>
          <div className="sticky top-14 z-20 -mx-4 mb-6 grid gap-3 border-b border-line bg-linen/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:w-64">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-soft" aria-hidden />
                <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search dishes or ingredients" className="pl-9" aria-label="Search dishes" />
              </div>
              <Select value={availability} onValueChange={(v) => setAvailability(v as Availability)}>
                <SelectTrigger className="w-auto min-w-40" aria-label="Show">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All dishes</SelectItem>
                  <SelectItem value="available">Available today</SelectItem>
                  <SelectItem value="off">Off today</SelectItem>
                  <SelectItem value="incomplete">Missing details ({incomplete})</SelectItem>
                </SelectContent>
              </Select>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn(freeOf.length && 'border-bistro bg-sage-soft')}>
                    <ShieldCheck aria-hidden />
                    {freeOf.length ? `Free of ${freeOf.length === 1 ? labels.allergen(freeOf[0]).toLowerCase() : `${freeOf.length} allergens`}` : 'Free of…'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-72 rounded-2xl border-line bg-paper">
                  <p className="text-sm font-semibold">Show dishes free of</p>
                  <p className="text-xs text-ink-soft">Counts traces (“may contain”) too.</p>
                  <div className="mt-3 grid grid-cols-2 gap-1.5">
                    {(meta.data?.allergens ?? []).map((a) => {
                      const on = freeOf.includes(a.id)
                      return (
                        <label key={a.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-sm hover:bg-linen">
                          <Checkbox checked={on} onCheckedChange={(v) => setFreeOf(v ? [...freeOf, a.id] : freeOf.filter((x) => x !== a.id))} />
                          {a.label}
                        </label>
                      )
                    })}
                  </div>
                  {freeOf.length > 0 && (
                    <Button variant="ghost" size="sm" className="mt-2" onClick={() => setFreeOf([])}>
                      Clear
                    </Button>
                  )}
                </PopoverContent>
              </Popover>
              <ToggleGroup
                type="single"
                value={view}
                onValueChange={(v) => v && setViewRemembered(v as View)}
                className="ml-auto rounded-full border border-input bg-paper p-0.5"
                aria-label="View"
              >
                <ToggleGroupItem value="grid" aria-label="Grid view" className="rounded-full px-3 data-[state=on]:bg-bistro data-[state=on]:text-paper">
                  <LayoutGrid aria-hidden />
                </ToggleGroupItem>
                <ToggleGroupItem value="list" aria-label="List view" className="rounded-full px-3 data-[state=on]:bg-bistro data-[state=on]:text-paper">
                  <List aria-hidden />
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5" role="tablist" aria-label="Categories">
              <CategoryTab active={category === null} onClick={() => setCategory(null)} count={all.length}>
                All
              </CategoryTab>
              {categories.map((c) => (
                <CategoryTab key={c} active={category === c} onClick={() => setCategory(category === c ? null : c)} count={counts.get(c) ?? 0}>
                  {c}
                </CategoryTab>
              ))}
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="grid place-items-center gap-3 py-16 text-center">
              <p className="text-ink-soft">No dishes match these filters.</p>
              {filtered && (
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  <X aria-hidden />
                  Clear filters
                </Button>
              )}
            </div>
          ) : view === 'grid' ? (
            <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((dish) => (
                <li key={dish.id}>
                  <DishCard dish={dish} currency={currency} onEdit={() => openEdit(dish)} onToggle={(available) => patchDish.mutate({ dish, body: { available } })} />
                </li>
              ))}
            </ul>
          ) : (
            <DishTable
              dishes={visible}
              currency={currency}
              onEdit={openEdit}
              onToggle={(dish, available) => patchDish.mutate({ dish, body: { available } })}
              onPrice={(dish, price) => patchDish.mutate({ dish, body: { price } })}
            />
          )}
        </>
      )}

      <DishSheet
        open={sheetOpen}
        onOpenChange={(open) => {
          setFormOpen(open)
          if (!open) clearDeepLink()
        }}
        dish={sheetDish}
        categories={categories}
        currency={currency}
        onOpenDish={openEdit}
      />
      <ImportMenuDialog
        open={importOpen || importParam}
        onOpenChange={(open) => {
          setImportOpen(open)
          if (!open) clearDeepLink()
        }}
      />
    </>
  )
}

function CategoryTab({ active, onClick, count, children }: { active: boolean; onClick: () => void; count: number; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
        active ? 'border-bistro bg-bistro text-paper' : 'border-input bg-paper text-ink hover:bg-linen-deep',
      )}
    >
      {children}
      <span className={cn('tabular text-xs', active ? 'text-paper/70' : 'text-ink-soft')}>{count}</span>
    </button>
  )
}
