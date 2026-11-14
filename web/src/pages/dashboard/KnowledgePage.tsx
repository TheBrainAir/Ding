import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { keys } from '@/api/queries'
import type { KnowledgeItem } from '@/api/types'
import { EmptyState, PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { timeAgo } from '@/lib/format'

const STARTERS: { title: string; hint: string }[] = [
  { title: 'Opening hours', hint: 'Mon–Fri 12:00–23:00, weekends 11:00–00:00. Kitchen closes 30 minutes earlier.' },
  { title: 'Wi-Fi', hint: 'Network name and password.' },
  { title: 'Payment', hint: 'Cards, cash, splitting the bill, service charge.' },
  { title: 'Children and pets', hint: 'High chairs, kids’ portions, dogs on the terrace.' },
  { title: 'Today’s specials', hint: 'What the kitchen recommends today.' },
]

export function KnowledgePage() {
  const items = useQuery({ queryKey: keys.knowledge, queryFn: api.knowledge })
  const [draft, setDraft] = useState<{ title: string; content: string; hint?: string } | null>(null)

  return (
    <>
      <PageHeader
        title="Knowledge"
        description="Facts about the restaurant the waiter can answer from: hours, Wi-Fi, payment, house rules. Keep each note short and specific."
        actions={
          <Button onClick={() => setDraft({ title: '', content: '' })} disabled={!!draft}>
            <Plus aria-hidden />
            Add note
          </Button>
        }
      />

      <div className="grid max-w-3xl gap-4">
        {draft && <NoteEditor initial={draft} onClose={() => setDraft(null)} />}

        {items.isPending ? (
          Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-28 rounded-[24px]" />)
        ) : items.isError ? (
          <p className="text-paprika">Could not load notes: {items.error.message}</p>
        ) : items.data.length === 0 && !draft ? (
          <EmptyState icon={<BookOpen />} title="No notes yet">
            Start with one of these, so guests get a real answer instead of “I’ll ask a colleague”.
            <span className="mt-4 flex flex-wrap justify-center gap-2">
              {STARTERS.map((s) => (
                <Button key={s.title} variant="outline" size="sm" onClick={() => setDraft({ title: s.title, content: '', hint: s.hint })}>
                  {s.title}
                </Button>
              ))}
            </span>
          </EmptyState>
        ) : (
          items.data.map((item) => <NoteCard key={item.id} item={item} />)
        )}
      </div>
    </>
  )
}

function NoteEditor({
  initial,
  item,
  onClose,
}: {
  initial: { title: string; content: string; hint?: string }
  item?: KnowledgeItem
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [title, setTitle] = useState(initial.title)
  const [content, setContent] = useState(initial.content)
  const save = useMutation({
    mutationFn: () =>
      item
        ? api.updateKnowledge(item.id, { title: title.trim(), content: content.trim() })
        : api.createKnowledge({ title: title.trim(), content: content.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.knowledge })
      toast(item ? 'Note saved' : 'Note added')
      onClose()
    },
    onError: (err: Error) => toast.error('Could not save the note', { description: err.message }),
  })

  return (
    <form
      className="grid gap-3 rounded-[24px] border-2 border-bistro bg-paper p-5"
      onSubmit={(e) => {
        e.preventDefault()
        if (title.trim() && content.trim()) save.mutate()
      }}
    >
      <Input aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title, e.g. Opening hours" autoFocus={!initial.title} required />
      <Textarea
        aria-label="Content"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={initial.hint ?? 'What should the waiter say?'}
        rows={4}
        autoFocus={!!initial.title}
        required
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending || !title.trim() || !content.trim()}>
          {save.isPending && <Loader2 className="animate-spin" aria-hidden />}
          {item ? 'Save note' : 'Add note'}
        </Button>
      </div>
    </form>
  )
}

function NoteCard({ item }: { item: KnowledgeItem }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const remove = useMutation({
    mutationFn: () => api.deleteKnowledge(item.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.knowledge })
      toast(`Deleted “${item.title}”`)
    },
    onError: (err: Error) => toast.error('Could not delete the note', { description: err.message }),
  })

  if (editing) return <NoteEditor item={item} initial={item} onClose={() => setEditing(false)} />

  return (
    <article className="group rounded-[24px] border border-line bg-paper p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-sans text-base font-semibold">{item.title}</h2>
        <div className="flex shrink-0 gap-1 opacity-70 transition-opacity group-hover:opacity-100">
          <Button variant="ghost" size="icon-sm" aria-label={`Edit ${item.title}`} onClick={() => setEditing(true)}>
            <Pencil aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete ${item.title}`}
            onClick={() => {
              if (window.confirm(`Delete “${item.title}”?`)) remove.mutate()
            }}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      </div>
      <p className="mt-1.5 whitespace-pre-line text-ink-soft">{item.content}</p>
      <p className="mt-3 text-xs text-ink-soft/80">Updated {timeAgo(item.updated_at)}</p>
    </article>
  )
}
