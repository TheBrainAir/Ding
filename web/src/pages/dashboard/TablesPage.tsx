import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import QRCode from 'qrcode'
import { Check, Copy, Download, ExternalLink, Loader2, Pencil, Plus, QrCode, Trash2 } from 'lucide-react'
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

const absoluteUrl = (table: Table) => new URL(table.url, window.location.origin).toString()

export function TablesPage() {
  const qc = useQueryClient()
  const tables = useQuery({ queryKey: keys.tables, queryFn: api.tables })
  const [label, setLabel] = useState('')
  const nextLabel = `Table ${(tables.data?.length ?? 0) + 1}`

  const create = useMutation({
    mutationFn: (l: string) => api.createTable({ label: l }),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: keys.tables })
      setLabel('')
      toast(`${t.label} is ready`, { description: 'Open it on the laptop next to the button.' })
    },
    onError: (err: Error) => toast.error('Could not add the table', { description: err.message }),
  })

  return (
    <>
      <PageHeader
        title="Tables"
        description="Each table has its own screen. Open it in Chrome on the laptop beside the button, or print the QR code."
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
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-72 rounded-[28px]" />
          ))}
        </div>
      ) : tables.isError ? (
        <p className="text-paprika">Could not load tables: {tables.error.message}</p>
      ) : tables.data.length === 0 ? (
        <EmptyState icon={<QrCode />} title="No tables yet">
          Add your first table above. You will get a link for its screen and a QR code to print.
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

function TableCard({ table }: { table: Table }) {
  const qc = useQueryClient()
  const url = absoluteUrl(table)
  const [renaming, setRenaming] = useState(false)
  const [label, setLabel] = useState(table.label)
  const [copied, setCopied] = useState(false)

  const qr = useQuery({
    queryKey: ['qr', url],
    queryFn: () => QRCode.toDataURL(url, { margin: 1, width: 360, color: { dark: '#17362a', light: '#fffdf8' } }),
    staleTime: Infinity,
  })

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

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast('Copy this link', { description: url })
    }
  }

  return (
    <li className="flex flex-col rounded-[28px] border border-line bg-paper p-5">
      <div className="flex items-start justify-between gap-3">
        {renaming ? (
          <form
            className="flex flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (label.trim()) rename.mutate()
            }}
          >
            <Input aria-label="Table name" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Escape' && setRenaming(false)} />
            <Button type="submit" size="sm" disabled={rename.isPending}>
              Save
            </Button>
          </form>
        ) : (
          <div className="min-w-0">
            <h2 className="truncate text-xl font-semibold">{table.label}</h2>
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-ink-soft">
              {table.active_session_id ? (
                <>
                  <span className="size-2 rounded-full bg-saffron" aria-hidden />
                  Guest talking now
                </>
              ) : (
                'Free'
              )}
            </p>
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
                  <AlertDialogDescription>Its link and QR code stop working. Orders already placed stay in the history.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep it</AlertDialogCancel>
                  <AlertDialogAction className="bg-paprika hover:bg-paprika-deep" onClick={() => remove.mutate()}>
                    Delete table
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>

      <div className="my-5 grid place-items-center">
        <div className="size-40 rounded-2xl bg-paper p-2 ring-1 ring-line">
          {qr.data ? <img src={qr.data} alt={`QR code for ${table.label}`} className="size-full" /> : <Skeleton className="size-full" />}
        </div>
      </div>

      <div className="mt-auto grid gap-2">
        <Button asChild variant="accent">
          <a href={table.url} target="_blank" rel="noreferrer">
            <ExternalLink aria-hidden />
            Open table
          </a>
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1" onClick={copy}>
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied ? 'Copied' : 'Copy link'}
          </Button>
          {qr.data && (
            <Button asChild variant="outline" size="sm" className="flex-1">
              <a href={qr.data} download={`${table.label.replace(/\s+/g, '-').toLowerCase()}-qr.png`}>
                <Download aria-hidden />
                QR image
              </a>
            </Button>
          )}
        </div>
      </div>
    </li>
  )
}
