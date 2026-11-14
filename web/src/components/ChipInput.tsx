import { useState, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Free-text chips (ingredients). Enter or comma adds; Backspace on empty removes the last. */
export function ChipInput({
  id,
  value,
  onChange,
  placeholder,
  className,
}: {
  id?: string
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  className?: string
}) {
  const [draft, setDraft] = useState('')

  const add = (raw: string) => {
    const parts = raw
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
    if (!parts.length) return
    const seen = new Set(value.map((v) => v.toLowerCase()))
    const next = [...value]
    for (const p of parts) {
      if (!seen.has(p.toLowerCase())) {
        seen.add(p.toLowerCase())
        next.push(p)
      }
    }
    onChange(next)
    setDraft('')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      add(draft)
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1))
    }
  }

  return (
    <div
      className={cn(
        'flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-paper px-2 py-1.5 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50',
        className,
      )}
    >
      {value.map((chip) => (
        <span key={chip} className="inline-flex items-center gap-1 rounded-full bg-linen-deep py-0.5 pr-1 pl-2.5 text-sm">
          {chip}
          <button
            type="button"
            onClick={() => onChange(value.filter((v) => v !== chip))}
            className="grid size-5 place-items-center rounded-full text-ink-soft hover:bg-paper hover:text-ink"
            aria-label={`Remove ${chip}`}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => add(draft)}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text')
          if (text.includes(',')) {
            e.preventDefault()
            add(text)
          }
        }}
        placeholder={value.length ? '' : placeholder}
        className="min-w-[8ch] flex-1 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  )
}
