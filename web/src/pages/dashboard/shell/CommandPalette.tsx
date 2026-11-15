import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { FileUp, FlaskConical, MonitorSmartphone, NotebookPen, Plus, UtensilsCrossed } from 'lucide-react'
import { api } from '@/api/client'
import { keys } from '@/api/queries'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command'
import { ALL_NAV } from './nav'

/** Cmd/Ctrl+K: jump to a page, open a table screen, start common actions, find a dish. */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate()
  const tables = useQuery({ queryKey: keys.tables, queryFn: api.tables, enabled: open })
  const dishes = useQuery({ queryKey: keys.dishes, queryFn: () => api.dishes(), enabled: open })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        onOpenChange(!open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  const run = (fn: () => void) => {
    onOpenChange(false)
    fn()
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search or jump to" description="Pages, tables, actions and dishes">
      <CommandInput placeholder="Type a page, a table or a dish…" />
      <CommandList className="max-h-[min(60vh,420px)]">
        <CommandEmpty>Nothing matches. Try a dish name or a page.</CommandEmpty>
        <CommandGroup heading="Go to">
          {ALL_NAV.map((item) => (
            <CommandItem key={item.to} value={`page ${item.label}`} onSelect={() => run(() => navigate(item.to))}>
              <item.icon aria-hidden />
              {item.label}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem value="add dish new" onSelect={() => run(() => navigate('/dashboard/menu?new=1'))}>
            <Plus aria-hidden />
            Add a dish
          </CommandItem>
          <CommandItem value="import menu photo pdf" onSelect={() => run(() => navigate('/dashboard/menu?import=1'))}>
            <FileUp aria-hidden />
            Import a menu from a photo or PDF
          </CommandItem>
          <CommandItem value="test the waiter playground chat" onSelect={() => run(() => navigate('/dashboard/playground'))}>
            <FlaskConical aria-hidden />
            Test the waiter
          </CommandItem>
          <CommandItem value="add knowledge note" onSelect={() => run(() => navigate('/dashboard/knowledge?new=1'))}>
            <NotebookPen aria-hidden />
            Add a knowledge note
          </CommandItem>
        </CommandGroup>
        {!!tables.data?.length && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Open a table screen">
              {tables.data.map((t) => (
                <CommandItem key={t.id} value={`table screen ${t.label}`} onSelect={() => run(() => window.open(t.url, '_blank', 'noopener'))}>
                  <MonitorSmartphone aria-hidden />
                  {t.label}
                  <CommandShortcut>new tab</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
        {!!dishes.data?.length && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Dishes">
              {dishes.data.map((d) => (
                <CommandItem key={d.id} value={`dish ${d.name} ${d.category}`} onSelect={() => run(() => navigate(`/dashboard/menu?dish=${d.id}`))}>
                  <UtensilsCrossed aria-hidden />
                  {d.name}
                  <CommandShortcut>{d.category}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  )
}
