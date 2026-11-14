import { useEffect, useId, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ImagePlus, Loader2, Sparkles, Trash2, X } from 'lucide-react'
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
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
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

export function DishFormSheet({
  open,
  onOpenChange,
  dish,
  categories,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null = new dish */
  dish: Dish | null
  categories: string[]
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto bg-paper p-0 sm:max-w-xl">
        {open && <DishForm key={dish?.id ?? 'new'} dish={dish} categories={categories} onDone={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  )
}

function DishForm({ dish, categories, onDone }: { dish: Dish | null; categories: string[]; onDone: () => void }) {
  const qc = useQueryClient()
  const meta = useMeta()
  const uid = useId()
  const [form, setForm] = useState<FormState>(() => fromDish(dish))
  const [suggested, setSuggested] = useState<Suggested | null>(null)
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null)
  const [removePhoto, setRemovePhoto] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      const body: DishInput = {
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
      let saved = dish ? await api.updateDish(dish.id, body) : await api.createDish(body)
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
  const photoSrc = photo?.url ?? (removePhoto ? null : dish?.photo_url)
  const categoryChoices = [...new Set([...categories, ...DEFAULT_CATEGORIES])]

  return (
    <form onSubmit={submit} className="flex min-h-full flex-col">
      <SheetHeader className="border-b border-line px-6 py-5">
        <SheetTitle className="font-display text-xl">{dish ? `Edit ${dish.name}` : 'New dish'}</SheetTitle>
        <SheetDescription>The waiter only states allergens you tick here. It never guesses.</SheetDescription>
      </SheetHeader>

      <div className="grid gap-6 px-6 py-6">
        {/* Photo */}
        <div className="flex items-center gap-4">
          <div className="size-28 shrink-0 overflow-hidden rounded-2xl">
            <DishPhoto src={photoSrc} name={form.name || 'New dish'} />
          </div>
          <div className="grid gap-2">
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
                Remove photo
              </Button>
            )}
          </div>
        </div>

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

        <div className="grid gap-1.5">
          <Label htmlFor={`${uid}-ingredients`}>Ingredients</Label>
          <ChipInput
            id={`${uid}-ingredients`}
            value={form.ingredients}
            onChange={(ingredients) => patch({ ingredients })}
            placeholder="Type an ingredient and press Enter"
          />
        </div>

        {/* Allergens */}
        <fieldset className="grid gap-3 rounded-2xl border border-line p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <legend className="float-left font-semibold">Allergens</legend>
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
              <p className="mt-1 text-ink-soft">
                Items marked AI were ticked for you. Untick anything that is wrong. Nothing is saved until you press Save.
              </p>
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

          <p className="text-sm text-ink-soft">Contains</p>
          <CheckboxGrid
            idPrefix={`${uid}-al`}
            options={allergenOptions}
            value={form.allergens}
            onChange={(v) => confirmToggle('allergens', v)}
            suggested={suggested?.allergens}
          />
          <p className="mt-2 text-sm text-ink-soft">May contain traces of</p>
          <CheckboxGrid
            idPrefix={`${uid}-mc`}
            options={allergenOptions}
            value={form.may_contain}
            onChange={(v) => confirmToggle('may_contain', v)}
            suggested={suggested?.may_contain}
            tone="traces"
          />
        </fieldset>

        <div className="grid gap-2">
          <p className="text-sm font-medium">Dietary tags</p>
          <ToggleChips
            label="Dietary tags"
            options={tagOptions}
            value={form.dietary_tags}
            onChange={(v) => confirmToggle('dietary_tags', v)}
            suggested={suggested?.dietary_tags}
          />
        </div>

        <label className="flex items-center justify-between gap-4 rounded-2xl bg-linen px-4 py-3">
          <span>
            <span className="block font-medium">Available today</span>
            <span className="text-sm text-ink-soft">Unavailable dishes are never offered to guests.</span>
          </span>
          <Switch checked={form.available} onCheckedChange={(available) => patch({ available })} />
        </label>

        {error && (
          <p role="alert" className="rounded-xl bg-paprika-soft px-3 py-2 text-sm text-paprika-deep">
            {error}
          </p>
        )}
      </div>

      <SheetFooter className="mt-auto flex-row items-center justify-between border-t border-line bg-paper px-6 py-4">
        {dish ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="ghost" className="text-paprika hover:bg-paprika-soft hover:text-paprika-deep">
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
                <AlertDialogAction className="bg-paprika hover:bg-paprika-deep" onClick={() => remove.mutate()}>
                  Delete dish
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" aria-hidden />}
            {dish ? 'Save dish' : 'Add dish'}
          </Button>
        </div>
      </SheetFooter>
    </form>
  )
}
