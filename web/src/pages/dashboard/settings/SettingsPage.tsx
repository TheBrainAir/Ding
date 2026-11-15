import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronRight, FlaskConical, Loader2, MicOff, Pause, Play } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { keys } from '@/api/queries'
import type { ModelOption, Restaurant, Voice } from '@/api/types'
import { PageHeader, Panel } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PRODUCT_NAME } from '@/config'
import { languageName } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useVoiceStatus } from '../shell/useShellData'

const CURRENCIES = ['USD', 'EUR', 'GBP', 'AMD', 'RUB', 'JPY', 'CHF', 'AED', 'TRY', 'GEL', 'CAD', 'AUD']
const MENU_LANGUAGES = ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'hy', 'ja', 'zh', 'ko', 'ar', 'tr']
const TABS = ['restaurant', 'voice', 'models'] as const
type Tab = (typeof TABS)[number]

type Editable = Omit<Restaurant, 'id'>

function editableFields(r: Restaurant): Editable {
  return {
    name: r.name,
    currency: r.currency,
    menu_language: r.menu_language,
    persona_name: r.persona_name,
    voice_id: r.voice_id,
    llm_model: r.llm_model,
    stt_model: r.stt_model,
    tts_model: r.tts_model,
  }
}

export function SettingsPage() {
  const restaurant = useQuery({ queryKey: keys.restaurant, queryFn: api.restaurant })

  return (
    <>
      <PageHeader title="Settings" description="How your restaurant appears, how the waiter introduces itself and sounds, and which models it uses." />
      {restaurant.isPending ? (
        <div className="grid gap-4">
          <Skeleton className="h-10 w-80 rounded-full" />
          <Skeleton className="h-72 rounded-[28px]" />
        </div>
      ) : restaurant.isError ? (
        <p className="text-ink">Could not load settings: {restaurant.error.message}</p>
      ) : (
        <SettingsForm key={restaurant.dataUpdatedAt} restaurant={restaurant.data} />
      )}
    </>
  )
}

function SettingsForm({ restaurant }: { restaurant: Restaurant }) {
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const tab: Tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'restaurant'
  const initial = editableFields(restaurant)
  const [form, setForm] = useState<Editable>(initial)
  const models = useQuery({ queryKey: keys.models, queryFn: api.models, staleTime: Infinity })
  const voices = useQuery({ queryKey: keys.voices, queryFn: api.voices, staleTime: 5 * 60_000 })
  const voiceStatus = useVoiceStatus()

  const dirty = (Object.keys(form) as (keyof Editable)[]).filter((k) => form[k] !== initial[k])
  const patch = (p: Partial<Editable>) => setForm((f) => ({ ...f, ...p }))

  const save = useMutation({
    mutationFn: () => api.updateRestaurant(Object.fromEntries(dirty.map((k) => [k, form[k]])) as Partial<Editable>),
    onSuccess: (r) => {
      qc.setQueryData(keys.restaurant, r)
      qc.invalidateQueries({ queryKey: keys.me })
      qc.invalidateQueries({ queryKey: keys.stats })
      toast('Settings saved')
    },
    onError: (err: Error) => toast.error('Could not save settings', { description: err.message }),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) return toast.error('The restaurant needs a name.')
    save.mutate()
  }

  return (
    <form onSubmit={submit} className="grid gap-6 pb-24">
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="restaurant">
            Restaurant
          </TabsTrigger>
          <TabsTrigger value="voice">
            Waiter and voice
          </TabsTrigger>
          <TabsTrigger value="models">
            Models
          </TabsTrigger>
        </TabsList>

        <TabsContent value="restaurant" className="mt-6">
          <Panel>
            <div className="grid items-start gap-5 sm:grid-cols-2">
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor="name">Restaurant name</Label>
                <Input id="name" value={form.name} onChange={(e) => patch({ name: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="currency">Currency</Label>
                <Select value={form.currency} onValueChange={(currency) => patch({ currency })}>
                  <SelectTrigger id="currency" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[...new Set([form.currency, ...CURRENCIES])].map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="menu-language">Menu language</Label>
                <Select value={form.menu_language} onValueChange={(menu_language) => patch({ menu_language })}>
                  <SelectTrigger id="menu-language" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[...new Set([form.menu_language, ...MENU_LANGUAGES])].map((l) => (
                      <SelectItem key={l} value={l}>
                        {languageName(l)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-ink-soft">The language your dishes are written in. Guests can speak any language.</p>
              </div>
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="voice" className="mt-6 grid gap-6">
          <Panel>
            <div className="grid gap-1.5 sm:max-w-sm">
              <Label htmlFor="persona">Name the waiter uses</Label>
              <Input id="persona" value={form.persona_name} onChange={(e) => patch({ persona_name: e.target.value })} placeholder={PRODUCT_NAME} />
              <p className="text-xs text-ink-soft">Guests hear it when the waiter introduces itself.</p>
            </div>

            <h2 className="mt-8 font-sans text-base font-semibold">Voice</h2>
            {voiceStatus === 'off' && (
              <div className="mt-3 flex gap-3 rounded-2xl bg-linen p-4 text-sm">
                <MicOff className="mt-0.5 size-4 shrink-0 text-ink-soft" aria-hidden />
                <div>
                  <p className="font-semibold">Voice needs an ElevenLabs key</p>
                  <p className="mt-1 max-w-[62ch] text-ink-soft">
                    Without it the waiter works in text: guests type on the table screen and read the replies. To turn on speech, set{' '}
                    <code className="rounded bg-paper px-1">ELEVENLABS_API_KEY</code> in <code className="rounded bg-paper px-1">backend/.env</code> and
                    restart the backend. The voices to choose from then appear here.
                  </p>
                </div>
              </div>
            )}
            <VoicePicker voices={voices.data} loading={voices.isPending} value={form.voice_id} onChange={(voice_id) => patch({ voice_id })} />

            <Collapsible className="mt-6">
              <CollapsibleTrigger className="group inline-flex items-center gap-1 rounded-full text-sm text-ink-soft hover:text-ink focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
                <ChevronRight className="size-4 transition-transform group-data-[state=open]:rotate-90" aria-hidden />
                Advanced
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3 grid gap-1.5 sm:max-w-md">
                <Label htmlFor="voice-id">Voice ID</Label>
                <Input id="voice-id" value={form.voice_id ?? ''} onChange={(e) => patch({ voice_id: e.target.value || null })} placeholder="ElevenLabs voice ID" />
                <p className="text-xs text-ink-soft">Only needed for a voice that is not in the list above.</p>
              </CollapsibleContent>
            </Collapsible>
          </Panel>

          <Link
            to="/dashboard/playground"
            className="group flex items-center gap-4 rounded-[28px] border border-line bg-paper p-5 transition-colors hover:border-bistro focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-saffron-soft">
              <FlaskConical className="size-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">Test the waiter</span>
              <span className="block text-sm text-ink-soft">Try the waiter in the Playground before guests do.</span>
            </span>
            <ChevronRight className="size-5 text-ink-soft transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        </TabsContent>

        <TabsContent value="models" className="mt-6">
          <Panel>
            <p className="max-w-[62ch] text-sm text-ink-soft">Which model holds the conversation, which one listens, and which one speaks.</p>
            <div className="mt-5 grid items-start gap-5 sm:grid-cols-3">
              <ModelSelect id="llm" label="Conversation" options={models.data?.llm} value={form.llm_model} onChange={(llm_model) => patch({ llm_model })} />
              <ModelSelect id="stt" label="Speech to text" options={models.data?.stt} value={form.stt_model} onChange={(stt_model) => patch({ stt_model })} />
              <ModelSelect id="tts" label="Text to speech" options={models.data?.tts} value={form.tts_model} onChange={(tts_model) => patch({ tts_model })} />
            </div>
          </Panel>
        </TabsContent>
      </Tabs>

      {dirty.length > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-20 flex justify-center px-4 animate-in fade-in-0 slide-in-from-bottom-2">
          <div className="flex items-center gap-3 rounded-lg border bg-background p-1.5 pl-4 text-foreground shadow-lg">
            <span className="text-sm">
              {dirty.length} unsaved {dirty.length === 1 ? 'change' : 'changes'}
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={() => setForm(initial)}>
              Discard
            </Button>
            <Button type="submit" size="sm" disabled={save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
              Save changes
            </Button>
          </div>
        </div>
      )}
    </form>
  )
}

function ModelSelect({
  id,
  label,
  options,
  value,
  onChange,
}: {
  id: string
  label: string
  options: ModelOption[] | undefined
  value: string
  onChange: (v: string) => void
}) {
  const list = options ?? []
  const all = list.some((o) => o.id === value) || !value ? list : [{ id: value, label: value }, ...list]
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value || undefined} onValueChange={onChange} disabled={!all.length}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={options ? 'None available' : 'Loading…'} />
        </SelectTrigger>
        <SelectContent>
          {all.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function VoicePicker({
  voices,
  loading,
  value,
  onChange,
}: {
  voices: Voice[] | undefined
  loading: boolean
  value: string | null
  onChange: (id: string) => void
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)

  useEffect(
    () => () => {
      audioRef.current?.pause()
    },
    [],
  )

  const preview = (voice: Voice) => {
    if (!voice.preview_url) return
    if (playing === voice.voice_id) {
      audioRef.current?.pause()
      setPlaying(null)
      return
    }
    audioRef.current?.pause()
    const audio = new Audio(voice.preview_url)
    audioRef.current = audio
    audio.onended = () => setPlaying(null)
    audio.onerror = () => {
      setPlaying(null)
      toast.error(`Could not play the ${voice.name} sample`)
    }
    setPlaying(voice.voice_id)
    void audio.play().catch(() => setPlaying(null))
  }

  if (loading) return <Skeleton className="mt-3 h-24 rounded-2xl" />
  if (!voices?.length) return null

  return (
    <div role="radiogroup" aria-label="Voice" className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {voices.map((v) => {
        const selected = v.voice_id === value
        const tags = Object.values(v.labels ?? {}).filter(Boolean).slice(0, 3)
        return (
          <div
            key={v.voice_id}
            className={cn(
              'flex items-center gap-3 rounded-[18px] border p-2.5 pl-4 transition-colors',
              selected ? 'border-bistro bg-sage-soft' : 'border-line bg-paper hover:border-input',
            )}
          >
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(v.voice_id)}
              className="min-w-0 flex-1 text-left focus-visible:outline-none"
            >
              <span className="flex items-center gap-2 font-medium">
                {v.name}
                {selected && <Check className="size-4 text-bistro" aria-hidden />}
              </span>
              {tags.length > 0 && <span className="block truncate text-xs text-ink-soft">{tags.join(', ')}</span>}
            </button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={() => preview(v)}
              disabled={!v.preview_url}
              aria-label={playing === v.voice_id ? `Stop ${v.name}` : `Play a sample of ${v.name}`}
            >
              {playing === v.voice_id ? <Pause aria-hidden /> : <Play aria-hidden />}
            </Button>
          </div>
        )
      })}
    </div>
  )
}
