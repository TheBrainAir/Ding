import { useId, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CircleCheck, FileUp, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { keys, useMeta } from '@/api/queries'
import type { DishDraft } from '@/api/types'
import { ChipInput } from '@/components/ChipInput'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { AiMark, ToggleChips } from './TagPickers'
import Stepper, { Step } from '@/components/reactbits/Stepper'

interface Row {
  key: number
  include: boolean
  price: string
  draft: DishDraft
}

export function ImportMenuDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden rounded-[28px] bg-paper p-0 sm:max-w-4xl">
        {open && <ImportFlow onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function ImportFlow({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient()
  const meta = useMeta()
  const uid = useId()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [fileName, setFileName] = useState('')
  const [dragging, setDragging] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const [savedCount, setSavedCount] = useState<number | null>(null)

  const read = useMutation({
    mutationFn: (file: File) => api.importMenu(file),
    onSuccess: ({ dishes }) => {
      setRows(dishes.map((draft, i) => ({ key: i, include: true, price: draft.price === null ? '' : String(draft.price), draft })))
    },
  })

  const save = useMutation({
    mutationFn: (drafts: DishDraft[]) => api.bulkCreateDishes(drafts),
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: keys.dishes })
      toast(`Added ${saved.length} ${saved.length === 1 ? 'dish' : 'dishes'} to the menu`)
      setSavedCount(saved.length)
    },
  })

  const pick = (file: File | undefined) => {
    if (!file) return
    setFileName(file.name)
    read.mutate(file)
  }

  const update = (key: number, change: Partial<DishDraft>, extra?: Partial<Row>) =>
    setRows((rs) => rs?.map((r) => (r.key === key ? { ...r, ...extra, draft: { ...r.draft, ...change } } : r)) ?? null)

  const chosen = rows?.filter((r) => r.include) ?? []
  const invalid = (r: Row) => !r.draft.name.trim() || r.price.trim() === '' || Number.isNaN(Number(r.price))

  const submit = () => {
    setShowErrors(true)
    if (!chosen.length || chosen.some(invalid)) return
    save.mutate(
      chosen.map((r) => ({
        ...r.draft,
        name: r.draft.name.trim(),
        category: r.draft.category.trim() || 'Other',
        price: Number(r.price),
      })),
    )
  }

  // Step 4: saved
  if (savedCount !== null) {
    return (
      <>
        <DialogHeader className="px-7 pt-7">
          <DialogTitle className="font-display text-xl">Menu imported</DialogTitle>
          <DialogDescription>The waiter can offer these dishes straight away.</DialogDescription>
        </DialogHeader>
        <ImportSteps step={5} />
        <div className="grid place-items-center gap-3 px-7 py-10 text-center">
          <span className="grid size-14 place-items-center rounded-full bg-sage-soft text-bistro">
            <CircleCheck className="size-7" aria-hidden />
          </span>
          <p className="font-display text-lg font-semibold">
            Added {savedCount} {savedCount === 1 ? 'dish' : 'dishes'} from {fileName}
          </p>
          <p className="max-w-sm text-sm text-ink-soft">Dishes without a photo are flagged on the menu so you can add one later.</p>
        </div>
        <DialogFooter className="border-t border-line px-7 py-4">
          <Button type="button" onClick={onDone}>
            Done
          </Button>
        </DialogFooter>
      </>
    )
  }

  // Steps 1 and 2: choose a file, then AI reads it
  if (!rows) {
    return (
      <>
        <DialogHeader className="px-7 pt-7">
          <DialogTitle className="font-display text-xl">Import a menu</DialogTitle>
          <DialogDescription>
            Upload a photo or PDF of your printed menu. AI reads the dishes, then you check every one before anything is saved.
          </DialogDescription>
        </DialogHeader>
        <ImportSteps step={read.isPending ? 2 : 1} />
        <div className="px-7 py-7">
          <label
            htmlFor={`${uid}-file`}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              pick(e.dataTransfer.files?.[0])
            }}
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-[24px] border-2 border-dashed border-input px-6 py-14 text-center transition-colors',
              dragging && 'border-saffron-deep bg-saffron-soft/40',
              read.isPending && 'pointer-events-none',
            )}
          >
            {read.isPending ? (
              <>
                <Loader2 className="size-8 animate-spin text-bistro" aria-hidden />
                <p className="font-semibold">Reading {fileName}…</p>
                <p className="text-sm text-ink-soft">This can take up to a minute for a long menu.</p>
              </>
            ) : (
              <>
                <span className="grid size-14 place-items-center rounded-full bg-saffron-soft">
                  <FileUp className="size-6" aria-hidden />
                </span>
                <p className="font-semibold">Drop a menu here, or choose a file</p>
                <p className="text-sm text-ink-soft">JPG, PNG or PDF</p>
              </>
            )}
          </label>
          <input
            id={`${uid}-file`}
            type="file"
            accept="image/*,application/pdf"
            className="sr-only"
            onChange={(e) => {
              pick(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          {read.error && (
            <p role="alert" className="mt-4 rounded-xl border border-input bg-linen-deep px-3 py-2 text-sm text-ink">
              Could not read that menu: {read.error.message}
            </p>
          )}
        </div>
      </>
    )
  }

  // Step 3: review the drafts
  const allergens = meta.data?.allergens ?? []
  const tags = meta.data?.dietary_tags ?? []
  return (
    <>
      <DialogHeader className="border-b border-line px-7 pt-7 pb-5">
        <DialogTitle className="font-display text-xl">
          Check {rows.length} {rows.length === 1 ? 'dish' : 'dishes'} from {fileName}
        </DialogTitle>
        <DialogDescription className="flex flex-wrap items-center gap-2">
          <AiMark /> Read by AI — verify names, prices and especially allergens before saving.
        </DialogDescription>
      </DialogHeader>
      <ImportSteps step={3} />

      <div className="flex-1 overflow-y-auto px-7 py-5">
        {rows.length === 0 && <p className="py-10 text-center text-ink-soft">No dishes were found in that file. Try a sharper photo.</p>}
        <ul className="grid gap-4">
          {rows.map((r) => {
            const bad = showErrors && r.include && invalid(r)
            return (
              <li
                key={r.key}
                className={cn(
                  'rounded-[22px] border p-4 transition-opacity',
                  r.include ? 'border-line bg-paper' : 'border-dashed border-line bg-linen/50 opacity-60',
                  bad && 'border-2 border-saffron-deep',
                )}
              >
                <div className="flex items-start gap-3">
                  <Checkbox
                    className="mt-2.5"
                    checked={r.include}
                    onCheckedChange={(v) => update(r.key, {}, { include: !!v })}
                    aria-label={`Include ${r.draft.name || 'this dish'}`}
                  />
                  <div className="grid flex-1 gap-3">
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_7rem]">
                      <Input aria-label="Name" value={r.draft.name} onChange={(e) => update(r.key, { name: e.target.value })} placeholder="Dish name" />
                      <Input
                        aria-label="Category"
                        value={r.draft.category}
                        onChange={(e) => update(r.key, { category: e.target.value })}
                        placeholder="Category"
                      />
                      <Input
                        aria-label="Price"
                        inputMode="decimal"
                        value={r.price}
                        onChange={(e) => update(r.key, {}, { price: e.target.value.replace(',', '.') })}
                        placeholder="Price"
                        aria-invalid={bad && (r.price.trim() === '' || Number.isNaN(Number(r.price)))}
                      />
                    </div>
                    <Textarea
                      aria-label="Description"
                      rows={2}
                      value={r.draft.description}
                      onChange={(e) => update(r.key, { description: e.target.value })}
                      placeholder="Description"
                    />
                    <ChipInput
                      value={r.draft.ingredients}
                      onChange={(ingredients) => update(r.key, { ingredients })}
                      placeholder="Ingredients"
                    />
                    <div className="grid gap-1.5">
                      <p className="text-xs font-medium text-ink-soft">Contains</p>
                      <ToggleChips
                        label="Allergens"
                        size="sm"
                        options={allergens}
                        value={r.draft.allergens}
                        onChange={(v) => update(r.key, { allergens: v })}
                        activeClass="bg-paprika text-white border-paprika"
                      />
                      <p className="mt-1 text-xs font-medium text-ink-soft">May contain</p>
                      <ToggleChips
                        label="May contain"
                        size="sm"
                        options={allergens}
                        value={r.draft.may_contain}
                        onChange={(v) => update(r.key, { may_contain: v })}
                        activeClass="bg-linen-deep text-ink border-ink-soft border-dashed"
                      />
                      <p className="mt-1 text-xs font-medium text-ink-soft">Dietary tags</p>
                      <ToggleChips
                        label="Dietary tags"
                        size="sm"
                        options={tags}
                        value={r.draft.dietary_tags}
                        onChange={(v) => update(r.key, { dietary_tags: v })}
                      />
                    </div>
                    {bad && <p className="text-sm font-semibold text-ink">Add a name and a price, or untick this dish.</p>}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove this dish"
                    onClick={() => setRows((rs) => rs?.filter((x) => x.key !== r.key) ?? null)}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      <DialogFooter className="items-center border-t border-line px-7 py-4 sm:justify-between">
        <Button type="button" variant="ghost" onClick={() => setRows(null)}>
          Use another file
        </Button>
        <div className="flex items-center gap-3">
          {save.error && <p className="text-sm font-semibold text-ink">{save.error.message}</p>}
          <Button type="button" onClick={submit} disabled={save.isPending || chosen.length === 0}>
            {save.isPending && <Loader2 className="animate-spin" aria-hidden />}
            Save {chosen.length} {chosen.length === 1 ? 'dish' : 'dishes'}
          </Button>
        </div>
      </DialogFooter>
    </>
  )
}

/** Upload → Reading → Review → Saved, as a step indicator (the content lives below it). */
function ImportSteps({ step }: { step: number }) {
  return (
    <div className="px-7 pt-4">
      <Stepper
        step={step}
        showFooter={false}
        disableStepIndicators
        frame={false}
        theme="light"
        transition="none"
        width="100%"
        contentClassName="hidden"
        style={
          {
            '--stepper-solid': 'var(--bistro)',
            '--stepper-solid-ink': 'var(--paper)',
            '--stepper-muted': 'var(--ink-soft)',
            '--stepper-faint': 'var(--line)',
            '--stepper-ink': 'var(--ink)',
          } as React.CSSProperties
        }
      >
        <Step title="Upload" />
        <Step title="Reading" />
        <Step title="Review" />
        <Step title="Saved" />
      </Stepper>
    </div>
  )
}
