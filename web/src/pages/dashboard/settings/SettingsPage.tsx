import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, Pause, Play } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { keys } from '@/api/queries'
import type { ModelOption, Restaurant, Voice } from '@/api/types'
import { PageHeader, Panel } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { PRODUCT_NAME } from '@/config'
import { languageName } from '@/lib/format'
import { cn } from '@/lib/utils'
import { TestWaiterChat } from './TestWaiterChat'

const CURRENCIES = ['USD', 'EUR', 'GBP', 'AMD', 'RUB', 'JPY', 'CHF', 'AED', 'TRY', 'GEL', 'CAD', 'AUD']
const MENU_LANGUAGES = ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'hy', 'ja', 'zh', 'ko', 'ar', 'tr']

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
      <PageHeader title="Settings" description="How your waiter introduces itself, sounds and thinks." />
      {restaurant.isPending ? (
        <Skeleton className="h-96 rounded-[28px]" />
      ) : restaurant.isError ? (
        <p className="text-paprika">Could not load settings: {restaurant.error.message}</p>
      ) : (
        <div className="grid gap-6">
          <SettingsForm key={restaurant.dataUpdatedAt} restaurant={restaurant.data} />
          <Panel aria-labelledby="test-title">
            <h2 id="test-title" className="text-lg font-semibold">
              Test the waiter
            </h2>
            <p className="mt-1 mb-5 text-ink-soft">
              Chat with {restaurant.data.persona_name || PRODUCT_NAME} exactly as a guest would, using a real table. Orders you place here go to the
              kitchen screen.
            </p>
            <TestWaiterChat persona={restaurant.data.persona_name || PRODUCT_NAME} currency={restaurant.data.currency} />
          </Panel>
        </div>
      )}
    </>
  )
}

function SettingsForm({ restaurant }: { restaurant: Restaurant }) {
  const qc = useQueryClient()
  const initial = editableFields(restaurant)
  const [form, setForm] = useState<Editable>(initial)
  const models = useQuery({ queryKey: keys.models, queryFn: api.models, staleTime: Infinity })
  const voices = useQuery({ queryKey: keys.voices, queryFn: api.voices, staleTime: 5 * 60_000 })

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
    <form onSubmit={submit} className="grid gap-6">
      <Panel aria-labelledby="general-title">
        <h2 id="general-title" className="text-lg font-semibold">
          Restaurant
        </h2>
        <div className="mt-5 grid items-start gap-5 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="name">Name</Label>
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

      <Panel aria-labelledby="voice-title">
        <h2 id="voice-title" className="text-lg font-semibold">
          Waiter
        </h2>
        <div className="mt-5 grid gap-1.5 sm:max-w-sm">
          <Label htmlFor="persona">Name the waiter uses</Label>
          <Input id="persona" value={form.persona_name} onChange={(e) => patch({ persona_name: e.target.value })} placeholder={PRODUCT_NAME} />
        </div>

        <h3 className="mt-7 font-sans text-sm font-semibold">Voice</h3>
        <VoicePicker voices={voices.data} loading={voices.isPending} value={form.voice_id} onChange={(voice_id) => patch({ voice_id })} />

        <h3 className="mt-7 font-sans text-sm font-semibold">Models</h3>
        <div className="mt-3 grid items-start gap-5 sm:grid-cols-3">
          <ModelSelect id="llm" label="Conversation" options={models.data?.llm} value={form.llm_model} onChange={(llm_model) => patch({ llm_model })} />
          <ModelSelect id="stt" label="Speech to text" options={models.data?.stt} value={form.stt_model} onChange={(stt_model) => patch({ stt_model })} />
          <ModelSelect id="tts" label="Text to speech" options={models.data?.tts} value={form.tts_model} onChange={(tts_model) => patch({ tts_model })} />
        </div>
      </Panel>

      <div className="sticky bottom-4 z-10 flex justify-end">
        <div className={cn('flex items-center gap-3 rounded-full bg-paper/95 p-1.5 pl-5 shadow-[0_12px_30px_-16px_rgb(23_54_42/0.5)] ring-1 ring-line backdrop-blur', !dirty.length && 'pl-1.5')}>
          {dirty.length > 0 && <span className="text-sm text-ink-soft">Unsaved changes</span>}
          <Button type="submit" disabled={!dirty.length || save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
            Save settings
          </Button>
        </div>
      </div>
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
  if (!voices?.length) {
    return (
      <div className="mt-3 grid gap-2 sm:max-w-md">
        <p className="text-sm text-ink-soft">
          No voices to choose from. Voices come from ElevenLabs, so the server needs its key. Until then the waiter replies in text.
        </p>
        <Input aria-label="Voice ID" value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder="Voice ID" />
      </div>
    )
  }

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
