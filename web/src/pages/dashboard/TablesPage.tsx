import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Armchair, Check, ChevronRight, Copy, ExternalLink, Loader2, MessagesSquare, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { keys } from '@/api/queries'
import type { Table } from '@/api/types'
import { EmptyState, PageHeader } from '@/components/PageHeader'
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
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

const absoluteUrl = (table: Table) => new URL(table.url, window.location.origin).toString()

/** Headless mode: the button box driven by a bridge on the laptop, without the screen. */
const bridgeCommand = (token: string) => `uv run ding-bridge --table ${token}`

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    toast('Copy this by hand', { description: text })
    return false
  }
}

export function TablesPage() {
  const qc = useQueryClient()
  const tables = useQuery({ queryKey: keys.tables, queryFn: api.tables, refetchInterval: 30_000 })
  const [label, setLabel] = useState('')
  const nextLabel = `Table ${(tables.data?.length ?? 0) + 1}`

  const create = useMutation({
    mutationFn: (l: string) => api.createTable({ label: l }),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: keys.tables })
      setLabel('')
      toast(`${t.label} is ready`, { description: 'Open its screen on the laptop next to the button.' })
    },
    onError: (err: Error) => toast.error('Could not add the table', { description: err.message }),
  })

  return (
    <>
      <PageHeader
        title="Tables"
        description="Each table has its own screen. Open it in Chrome on the laptop beside the button, then use “Connect table button” on that screen to pair the button over USB or Bluetooth."
      />

      <form
        className="mb-8 flex max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          create.mutate(label.trim() || nextLabel)
        }}
      >
        <Input aria-label="New table name" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={nextLabel} />
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
          Add table
        </Button>
      </form>

      {tables.isPending ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 2 }, (_, i) => (
            <Skeleton key={i} className="h-64 rounded-[28px]" />
          ))}
        </div>
      ) : tables.isError ? (
        <p>Could not load tables: {tables.error.message}</p>
      ) : tables.data.length === 0 ? (
        <EmptyState icon={<Armchair />} title="No tables yet">
          Add your first table above. You will get a link to its screen for the laptop next to the button.
        </EmptyState>
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {tables.data.map((t) => (
            <TableCard key={t.id} table={t} />
          ))}
        </ul>
      )}

      <p className="mt-8 max-w-[70ch] text-sm text-ink-soft">
        Links point to {window.location.origin}. A phone can only open them if it can reach this computer, so for the demo open the table on
        the laptop itself.
      </p>
    </>
  )
}

function CopyButton({
  text,
  label,
  children,
  className,
  variant = 'outline',
  size = 'sm',
}: {
  text: string
  label: string
  children?: React.ReactNode
  className?: string
  variant?: 'outline' | 'ghost'
  size?: 'sm' | 'xs'
}) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      aria-label={copied ? 'Copied' : label}
      onClick={async () => {
        if (await copyText(text)) {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }
      }}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      {copied ? 'Copied' : (children ?? 'Copy')}
    </Button>
  )
}

function TableCard({ table }: { table: Table }) {
  const qc = useQueryClient()
  const [renaming, setRenaming] = useState(false)
  const [label, setLabel] = useState(table.label)
  const active = table.active_session_id !== null
  const url = absoluteUrl(table)

  const rename = useMutation({
    mutationFn: () => api.updateTable(table.id, { label: label.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.tables })
      setRenaming(false)
    },
    onError: (err: Error) => toast.error('Could not rename the table', { description: err.message }),
  })

  const remove = useMutation({
    mutationFn: () => api.deleteTable(table.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.tables })
      toast(`Deleted ${table.label}`)
    },
    onError: (err: Error) => toast.error('Could not delete the table', { description: err.message }),
  })

  const reset = useMutation({
    mutationFn: () => api.resetTable(table.token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.tables })
      qc.invalidateQueries({ queryKey: keys.sessions })
      qc.invalidateQueries({ queryKey: keys.stats })
      toast(`${table.label} is ready for a new guest`)
    },
    onError: (err: Error) => toast.error(`Could not reset ${table.label}`, { description: err.message }),
  })

  const newGuestButton = (
    <Button type="button" variant="outline" size="sm" className="flex-1" disabled={reset.isPending} onClick={active ? undefined : () => reset.mutate()}>
      {reset.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <RotateCcw aria-hidden />}
      New guest
    </Button>
  )

  return (
    <li className="flex flex-col gap-5 rounded-[28px] border border-line bg-paper p-5">
      <div className="flex items-start justify-between gap-3">
        {renaming ? (
          <form
            className="flex flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (label.trim()) rename.mutate()
            }}
          >
            <Input
              aria-label="Table name"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              autoFocus
              onKeyDown={(e) => e.key === 'Escape' && setRenaming(false)}
            />
            <Button type="submit" size="sm" disabled={rename.isPending}>
              Save
            </Button>
          </form>
        ) : (
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-semibold whitespace-nowrap',
                  active ? 'bg-saffron-soft text-ink' : 'bg-linen-deep text-ink-soft',
                )}
              >
                <span className={cn('size-2 rounded-full', active ? 'animate-pulse bg-saffron-deep motion-reduce:animate-none' : 'bg-input')} aria-hidden />
                {active ? 'Guest talking' : 'Free'}
              </span>
              {active && (
                <Link
                  to={`/dashboard/conversations/${table.active_session_id}`}
                  className="inline-flex items-center gap-1 font-medium whitespace-nowrap text-ink underline-offset-4 hover:underline"
                >
                  <MessagesSquare className="size-3.5" aria-hidden />
                  Conversation
                </Link>
              )}
            </p>
            <h2 className="mt-2 truncate text-xl font-semibold">{table.label}</h2>
          </div>
        )}
        {!renaming && (
          <div className="flex shrink-0">
            <Button variant="ghost" size="icon-sm" aria-label={`Rename ${table.label}`} onClick={() => setRenaming(true)}>
              <Pencil aria-hidden />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`Delete ${table.label}`}>
                  <Trash2 aria-hidden />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {table.label}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Its screen link and token stop working. Orders already placed stay in the history.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep it</AlertDialogCancel>
                  <AlertDialogAction onClick={() => remove.mutate()}>
                    Delete table
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>

      <div className="grid gap-2">
        <Button asChild variant="accent">
          <a href={table.url} target="_blank" rel="noreferrer">
            <ExternalLink aria-hidden />
            Open table screen
          </a>
        </Button>
        <div className="flex gap-2">
          <CopyButton text={url} label={`Copy the screen link for ${table.label}`} className="flex-1">
            Copy link
          </CopyButton>
          {active ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>{newGuestButton}</AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Start a new guest at {table.label}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The current conversation ends and the waiter forgets it, including allergies. Orders already sent to the kitchen stay.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep talking</AlertDialogCancel>
                  <AlertDialogAction onClick={() => reset.mutate()}>New guest</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            newGuestButton
          )}
        </div>
      </div>

      <div className="mt-auto flex items-center gap-2 border-t border-line pt-4 text-sm">
        <span className="text-ink-soft">Token</span>
        <code className="min-w-0 flex-1 truncate font-mono text-ink" title={table.token}>
          {table.token}
        </code>
        <CopyButton text={table.token} label={`Copy the token for ${table.label}`} variant="ghost" size="xs" />
      </div>

      <details className="group -mt-3 text-sm">
        <summary className="flex cursor-pointer list-none items-center gap-1 text-ink-soft select-none hover:text-ink [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden />
          Headless mode (no screen)
        </summary>
        <div className="mt-2 grid gap-2">
          <p className="text-ink-soft">
            Optional, for a table without a screen: run the button bridge on the laptop next to the button box instead.
          </p>
          <div className="flex items-start gap-2 rounded-xl bg-linen p-2 pl-3">
            <code className="min-w-0 flex-1 py-0.5 font-mono leading-relaxed break-all text-ink">
              uv run ding-bridge <span className="whitespace-nowrap">--table</span> {table.token}
            </code>
            <CopyButton text={bridgeCommand(table.token)} label={`Copy the bridge command for ${table.label}`} variant="ghost" size="xs" />
          </div>
        </div>
      </details>
    </li>
  )
}
