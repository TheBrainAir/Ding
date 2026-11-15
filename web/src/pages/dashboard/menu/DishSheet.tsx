import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy, ImagePlus, Loader2, Sparkles, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { keys, useMeta } from '@/api/queries'
import type { Allergen, DietaryTag, Dish, DishInput } from '@/api/types'
import { ChipInput } from '@/components/ChipInput'
import { DishPhoto } from '@/components/dish/DishPhoto'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { DishCard } from './DishCard'
import { AiMark, CheckboxGrid, ToggleChips } from './TagPickers'

const DEFAULT_CATEGORIES = ['Starters', 'Mains', 'Sides', 'Desserts', 'Drinks']

interface Suggested {
  allergens: Set<Allergen>
  may_contain: Set<Allergen>
  dietary_tags: Set<DietaryTag>
  rationale: string
}

interface FormState {
  name: string
  description: string
  category: string
  price: string
  ingredients: string[]
  allergens: Allergen[]
  may_contain: Allergen[]
  dietary_tags: DietaryTag[]
  available: boolean
}

function fromDish(dish: Dish | null): FormState {
  return {
    name: dish?.name ?? '',
    description: dish?.description ?? '',
    category: dish?.category ?? '',
    price: dish ? String(dish.price) : '',
    ingredients: dish?.ingredients ?? [],
    allergens: dish?.allergens ?? [],
    may_contain: dish?.may_contain ?? [],
    dietary_tags: dish?.dietary_tags ?? [],
    available: dish?.available ?? true,
  }
}

function toInput(form: FormState): DishInput {
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    category: form.category.trim(),
    price: Number(form.price),
    ingredients: form.ingredients,
    allergens: form.allergens,
    may_contain: form.may_contain,
    dietary_tags: form.dietary_tags,
    available: form.available,
  }
}

/**
 * Wide sheet: the form on the left, the dish card it produces on the right.
 * Closing with unsaved changes asks first.
 */
export function DishSheet({
  open,
  onOpenChange,
  dish,
  categories,
  currency,
  onOpenDish,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null = new dish */
  dish: Dish | null
  categories: string[]
  currency: string
  /** Switch the sheet to another dish (after Duplicate). */
  onOpenDish: (dish: Dish) => void
}) {
  const dirtyRef = useRef(false)
  const [confirmClose, setConfirmClose] = useState(false)

  const requestOpenChange = (next: boolean) => {
    if (!next && dirtyRef.current) {
      setConfirmClose(true)
      return
    }
    onOpenChange(next)
  }

  return (
    <>
      <Sheet open={open} onOpenChange={requestOpenChange}>
        <SheetContent className="w-full gap-0 overflow-y-auto bg-paper p-0 sm:max-w-4xl">
          {open && (
            <DishForm
              key={dish?.id ?? 'new'}
              dish={dish}
              categories={categories}
              currency={currency}
              onDirtyChange={(d) => {
                dirtyRef.current = d
              }}
              onDone={() => {
                dirtyRef.current = false
                onOpenChange(false)
              }}
              onCancel={() => requestOpenChange(false)}
              onOpenDish={onOpenDish}
            />
          )}
        </SheetContent>
      </Sheet>
      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard your changes?</AlertDialogTitle>
            <AlertDialogDescription>You edited this dish but did not save it. Closing now loses those edits.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                dirtyRef.current = false
                setConfirmClose(false)
                onOpenChange(false)
              }}
            >
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 border-b border-line pb-7 last:border-b-0 last:pb-0">
      <div>
        <h3 className="font-sans text-base font-semibold">{title}</h3>
        {hint && <p className="text-sm text-ink-soft">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function DishForm({
  dish,
  categories,
  currency,
  onDirtyChange,
  onDone,
  onCancel,
  onOpenDish,
}: {
  dish: Dish | null
  categories: string[]
  currency: string
  onDirtyChange: (dirty: boolean) => void
  onDone: () => void
  onCancel: () => void
  onOpenDish: (dish: Dish) => void
}) {
  const qc = useQueryClient()
  const meta = useMeta()
  const uid = useId()
  const [initial] = useState<FormState>(() => fromDish(dish))
  const [form, setForm] = useState<FormState>(initial)
  const [suggested, setSuggested] = useState<Suggested | null>(null)
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null)
  const [removePhoto, setRemovePhoto] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty = JSON.stringify(form) !== JSON.stringify(initial) || !!photo || removePhoto
  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])

  // Free the preview URL when it is replaced or the form closes.
  useEffect(() => () => (photo ? URL.revokeObjectURL(photo.url) : undefined), [photo])

  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }))

  // A human touching a field confirms it: drop the AI marks for whatever changed.
  const confirmToggle = <K extends 'allergens' | 'may_contain' | 'dietary_tags'>(field: K, next: FormState[K]) => {
    if (suggested) {
      const prev = new Set<string>(form[field])
      const now = new Set<string>(next)
      const changed = [...prev, ...now].filter((v) => prev.has(v) !== now.has(v))
      const set = new Set<string>(suggested[field])
      changed.forEach((v) => set.delete(v))
      setSuggested({ ...suggested, [field]: set })
    }
    patch({ [field]: next } as Partial<FormState>)
  }

  const suggest = useMutation({
    mutationFn: () => api.suggestAllergens({ name: form.name, description: form.description, ingredients: form.ingredients }),
    onSuccess: (s) => {
      const add = <T extends string>(current: T[], incoming: T[]) => {
        const have = new Set(current)
        const fresh = incoming.filter((x) => !have.has(x))
        return { merged: [...current, ...fresh], fresh: new Set(fresh) }
      }
      const a = add(form.allergens, s.allergens)
      const m = add(form.may_contain, s.may_contain)
      const t = add(form.dietary_tags, s.dietary_tags)
      patch({ allergens: a.merged, may_contain: m.merged, dietary_tags: t.merged })
      setSuggested({ allergens: a.fresh, may_contain: m.fresh, dietary_tags: t.fresh, rationale: s.rationale })
      if (!a.fresh.size && !m.fresh.size && !t.fresh.size) {
        toast('No new allergens suggested', { description: s.rationale || 'The AI agrees with what is already ticked.' })
      }
    },
    onError: (err: Error) => toast.error('Could not suggest allergens', { description: err.message }),
  })

  const save = useMutation({
    mutationFn: async () => {
      let saved = dish ? await api.updateDish(dish.id, toInput(form)) : await api.createDish(toInput(form))
      if (photo) saved = await api.uploadDishPhoto(saved.id, photo.file)
      else if (removePhoto && saved.photo_url) saved = await api.deleteDishPhoto(saved.id)
      return saved
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: keys.dishes })
      toast(dish ? `Saved ${saved.name}` : `Added ${saved.name} to the menu`)
      onDone()
    },
    onError: (err: Error) => setError(err.message),
  })

  const duplicate = useMutation({
    mutationFn: () => api.createDish({ ...toInput(fromDish(dish)), name: `${dish!.name} (copy)` }),
    onSuccess: (copy) => {
      qc.invalidateQueries({ queryKey: keys.dishes })
      toast(`Duplicated ${dish!.name}`, { description: 'The copy has no photo yet.' })
      onOpenDish(copy)
    },
    onError: (err: Error) => toast.error('Could not duplicate the dish', { description: err.message }),
  })

  const remove = useMutation({
    mutationFn: () => api.deleteDish(dish!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.dishes })
      toast(`Deleted ${dish!.name}`)
      onDone()
    },
    onError: (err: Error) => toast.error('Could not delete the dish', { description: err.message }),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!form.name.trim()) return setError('Give the dish a name.')
    const price = Number(form.price)
    if (form.price.trim() === '' || Number.isNaN(price) || price < 0) return setError('Enter a price, for example 12.50.')
    if (!form.category.trim()) return setError('Pick or type a category.')
    save.mutate()
  }

  const allergenOptions = meta.data?.allergens ?? []
  const tagOptions = meta.data?.dietary_tags ?? []
  const pendingAi = suggested && suggested.allergens.size + suggested.may_contain.size + suggested.dietary_tags.size > 0
  const photoSrc = photo?.url ?? (removePhoto ? null : (dish?.photo_url ?? null))
  const categoryChoices = [...new Set([...categories, ...DEFAULT_CATEGORIES])]
  const priceNumber = form.price.trim() === '' || Number.isNaN(Number(form.price)) ? null : Number(form.price)

  return (
    <form onSubmit={submit} className="flex min-h-full flex-col">
      <SheetHeader className="border-b border-line px-6 py-5">
        <SheetTitle className="font-display text-xl">{dish ? `Edit ${dish.name}` : 'New dish'}</SheetTitle>
        <SheetDescription>The waiter only states allergens you tick here. It never guesses.</SheetDescription>
      </SheetHeader>

      <div className="grid flex-1 gap-8 px-6 py-6 md:grid-cols-[minmax(0,1fr)_280px]">
        <div className="grid content-start gap-7">
          <Section title="Basics">
            <div className="grid gap-1.5">
              <Label htmlFor={`${uid}-name`}>Name</Label>
              <Input id={`${uid}-name`} value={form.name} onChange={(e) => patch({ name: e.target.value })} required />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor={`${uid}-category`}>Category</Label>
                <Input
                  id={`${uid}-category`}
                  list={`${uid}-categories`}
                  value={form.category}
                  onChange={(e) => patch({ category: e.target.value })}
                  placeholder="Mains"
                />
                <datalist id={`${uid}-categories`}>
                  {categoryChoices.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${uid}-price`}>Price</Label>
                <Input
                  id={`${uid}-price`}
                  inputMode="decimal"
                  value={form.price}
                  onChange={(e) => patch({ price: e.target.value.replace(',', '.') })}
                  placeholder="12.50"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${uid}-description`}>Description</Label>
              <Textarea
                id={`${uid}-description`}
                value={form.description}
                onChange={(e) => patch({ description: e.target.value })}
                placeholder="What a guest should know: how it is cooked, how big it is, how spicy."
                rows={3}
              />
            </div>
          </Section>

          <Section title="Photo" hint="Guests see it on the table screen when the waiter mentions the dish.">
            <div className="flex items-center gap-4">
              <div className="size-24 shrink-0 overflow-hidden rounded-2xl">
                <DishPhoto src={photoSrc} name={form.name || 'New dish'} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" asChild>
                  <label htmlFor={`${uid}-photo`} className="cursor-pointer">
                    <ImagePlus aria-hidden />
                    {photoSrc ? 'Replace photo' : 'Add photo'}
                  </label>
                </Button>
                <input
                  id={`${uid}-photo`}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) {
                      setPhoto({ file, url: URL.createObjectURL(file) })
                      setRemovePhoto(false)
                    }
                    e.target.value = ''
                  }}
                />
                {photoSrc && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setPhoto(null)
                      setRemovePhoto(true)
                    }}
                  >
                    <X aria-hidden />
                    Remove
                  </Button>
                )}
              </div>
            </div>
          </Section>

          <Section title="Ingredients and allergens" hint="Ingredients feed the allergen suggestion. Tick allergens yourself or let AI suggest them for you to check.">
            <div className="grid gap-1.5">
              <Label htmlFor={`${uid}-ingredients`}>Ingredients</Label>
              <ChipInput
                id={`${uid}-ingredients`}
                value={form.ingredients}
                onChange={(ingredients) => patch({ ingredients })}
                placeholder="Type an ingredient and press Enter"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">Contains</p>
              <Button
                type="button"
                variant="accent"
                size="sm"
                onClick={() => suggest.mutate()}
                disabled={suggest.isPending || (!form.name.trim() && !form.ingredients.length)}
              >
                {suggest.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
                Suggest allergens
              </Button>
            </div>

            {pendingAi && (
              <div className="rounded-xl border border-dashed border-saffron-deep bg-saffron-soft/60 p-3 text-sm" role="status">
                <p className="flex items-center gap-2 font-semibold text-[#6b4100]">
                  <AiMark /> AI-suggested — verify
                </p>
                {suggested.rationale && <p className="mt-1 text-ink">{suggested.rationale}</p>}
                <p className="mt-1 text-ink-soft">Items marked AI were ticked for you. Untick anything that is wrong. Nothing is saved until you press Save.</p>
                <div className="mt-2 flex gap-2">
                  <Button type="button" size="xs" variant="outline" onClick={() => setSuggested(null)}>
                    I checked them
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      patch({
                        allergens: form.allergens.filter((a) => !suggested.allergens.has(a)),
                        may_contain: form.may_contain.filter((a) => !suggested.may_contain.has(a)),
                        dietary_tags: form.dietary_tags.filter((t) => !suggested.dietary_tags.has(t)),
                      })
                      setSuggested(null)
                    }}
                  >
                    Undo suggestions
                  </Button>
                </div>
              </div>
            )}

            <CheckboxGrid
              idPrefix={`${uid}-al`}
              options={allergenOptions}
              value={form.allergens}
              onChange={(v) => confirmToggle('allergens', v)}
              suggested={suggested?.allergens}
            />
            <p className="mt-1 text-sm font-medium">May contain traces of</p>
            <CheckboxGrid
              idPrefix={`${uid}-mc`}
              options={allergenOptions}
              value={form.may_contain}
              onChange={(v) => confirmToggle('may_contain', v)}
              suggested={suggested?.may_contain}
              tone="traces"
            />
          </Section>

          <Section title="Dietary tags and availability">
            <ToggleChips
              label="Dietary tags"
              options={tagOptions}
              value={form.dietary_tags}
              onChange={(v) => confirmToggle('dietary_tags', v)}
              suggested={suggested?.dietary_tags}
            />
            <label className="flex items-center justify-between gap-4 rounded-2xl bg-linen px-4 py-3">
              <span>
                <span className="block font-medium">Available today</span>
                <span className="text-sm text-ink-soft">Unavailable dishes are never offered to guests.</span>
              </span>
              <Switch checked={form.available} onCheckedChange={(available) => patch({ available })} />
            </label>
          </Section>
        </div>

        <aside className="hidden md:block" aria-label="Preview">
          <div className="sticky top-6 grid gap-2">
            <p className="text-sm font-medium text-ink-soft">How it looks on the menu</p>
            <DishCard
              preview
              currency={currency}
              dish={{
                name: form.name,
                description: form.description,
                category: form.category,
                price: priceNumber,
                photo_url: photoSrc,
                ingredients: form.ingredients,
                allergens: form.allergens,
                may_contain: form.may_contain,
                dietary_tags: form.dietary_tags,
                available: form.available,
              }}
            />
          </div>
        </aside>
      </div>

      {error && (
        <p role="alert" className="mx-6 mb-4 rounded-xl bg-linen-deep px-3 py-2 text-sm text-ink">
          {error}
        </p>
      )}

      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t border-line bg-paper px-6 py-4">
        {dish ? (
          <div className="flex gap-1">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="ghost">
                  <Trash2 aria-hidden />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {dish.name}?</AlertDialogTitle>
                  <AlertDialogDescription>The waiter stops offering it straight away. Past orders keep their copy.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep it</AlertDialogCancel>
                  <AlertDialogAction onClick={() => remove.mutate()}>Delete dish</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button type="button" variant="ghost" onClick={() => duplicate.mutate()} disabled={duplicate.isPending || dirty} title={dirty ? 'Save your changes first' : undefined}>
              {duplicate.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Copy aria-hidden />}
              Duplicate
            </Button>
          </div>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" aria-hidden />}
            {dish ? 'Save dish' : 'Add dish'}
          </Button>
        </div>
      </div>
    </form>
  )
}
