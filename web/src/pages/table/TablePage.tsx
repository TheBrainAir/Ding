import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import {
  BellRing,
  Bluetooth,
  BluetoothSearching,
  Cable,
  ChevronDown,
  Keyboard,
  Loader2,
  RotateCcw,
  SendHorizontal,
  Unplug,
  Usb,
  Volume2,
} from 'lucide-react'
import { api, ApiError } from '@/api/client'
import { keys } from '@/api/queries'
import type { ButtonState } from '@/api/types'
import { BellMark } from '@/components/brand/BellMark'
import { VoiceOrb } from '@/components/orb/VoiceOrb'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { PRODUCT_NAME } from '@/config'
import { languageName, nativeLanguageName } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { ButtonTransport } from '@/lib/voice'
import { OrderPanel } from './OrderPanel'
import { MentionedDishes } from './MentionedDishes'
import { RotatingHint } from './RotatingHint'
import { TableConversation, type ConversationSnapshot } from './tableConversation'

export function TablePage() {
  const { token = '' } = useParams()
  // Remount per token so every table gets a fresh conversation.
  return <TableScreen key={token} token={token} />
}

function isTypingTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
}

function TableScreen({ token }: { token: string }) {
  const [conversation] = useState(() => new TableConversation(token))
  const snap = useSyncExternalStore(conversation.subscribe, conversation.getSnapshot)
  const info = useQuery({ queryKey: keys.table(token), queryFn: () => api.table(token), retry: 1, refetchInterval: 20_000 })
  const [typing, setTyping] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (info.data) conversation.configure(info.data)
  }, [conversation, info.data])

  useEffect(() => {
    conversation.attach()
    return () => conversation.detach()
  }, [conversation])

  // Space bar = the button. Any click or key unlocks sound for serial presses later.
  useEffect(() => {
    let spaceDown = false
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isTypingTarget(e.target)) return
      e.preventDefault()
      if (e.repeat || spaceDown) return
      spaceDown = true
      conversation.pressStart()
    }
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !spaceDown) return
      e.preventDefault()
      spaceDown = false
      conversation.pressEnd()
    }
    const blur = () => {
      if (spaceDown) {
        spaceDown = false
        conversation.pressEnd()
      }
    }
    const unlock = () => conversation.unlock()
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    window.addEventListener('pointerdown', unlock)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
      window.removeEventListener('pointerdown', unlock)
    }
  }, [conversation])

  useEffect(() => {
    document.title = info.data ? `${info.data.table_label} — ${info.data.restaurant_name}` : PRODUCT_NAME
  }, [info.data])

  if (info.isPending) {
    return (
      <Shell>
        <div className="grid flex-1 place-items-center text-linen/70">
          <Loader2 className="size-8 animate-spin" aria-label="Loading" />
        </div>
      </Shell>
    )
  }

  if (info.isError) {
    const notFound = info.error instanceof ApiError && info.error.status === 404
    return (
      <Shell>
        <div className="mx-auto grid max-w-md flex-1 place-content-center gap-4 px-6 text-center">
          <BellMark onDark className="mx-auto size-12" />
          <h1 className="text-2xl text-linen">{notFound ? 'This table link is not valid' : 'Cannot reach the restaurant'}</h1>
          <p className="text-linen/70">
            {notFound
              ? 'Ask a member of staff for a new link, or open the table again from the dashboard.'
              : 'Check that the server is running, then reload this page.'}
          </p>
          <Button variant="accent" className="mx-auto" onClick={() => info.refetch()}>
            Try again
          </Button>
        </div>
      </Shell>
    )
  }

  const table = info.data
  const persona = table.persona_name || PRODUCT_NAME
  const voiceInput = snap.voiceEnabled && (snap.mic === 'unknown' || snap.mic === 'ready')
  const showText = typing || !voiceInput

  const onPressStart = () => {
    if (!voiceInput) {
      inputRef.current?.focus()
      return
    }
    conversation.pressStart()
  }

  const newGuest = async () => {
    setTyping(false)
    await conversation.reset()
    void info.refetch()
  }

  return (
    <Shell>
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 pt-5 sm:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <BellMark onDark className="size-8" />
          <div className="min-w-0">
            <p className="truncate font-display text-lg font-semibold text-linen">{table.restaurant_name}</p>
            <p className="text-sm text-linen/65">{table.table_label}</p>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {snap.language && <LanguageBadge code={snap.language} />}
          <ButtonControl
            snap={snap}
            onConnect={(transport) => conversation.connectButton(transport)}
            onDisconnect={() => conversation.disconnectButton()}
          />
          <Button
            variant="ghost"
            size="sm"
            className="text-linen hover:bg-white/10 hover:text-linen"
            onClick={newGuest}
          >
            <RotateCcw aria-hidden />
            New guest
          </Button>
        </div>
      </header>

      <main className="grid flex-1 grid-cols-1 gap-6 px-5 pb-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)] lg:gap-10">
        <section className="flex min-w-0 flex-col items-center justify-center gap-2 pt-4" aria-label="Talk to the waiter">
          <VoiceOrb
            state={snap.state}
            getLevel={conversation.level}
            onPressStart={onPressStart}
            onPressEnd={conversation.pressEnd}
            label={orbLabel(snap.state, snap.latched, voiceInput)}
            inputMode={voiceInput ? 'voice' : 'text'}
          />

          <div className="flex w-full max-w-2xl flex-col items-center gap-4">
            <StatusLine state={snap.state} latched={snap.latched} persona={persona} voiceInput={voiceInput} />
            <Captions snap={snap} persona={persona} />
            {snap.notice && <NoticePill notice={snap.notice} onDismiss={() => conversation.dismissNotice()} />}
            {snap.audioLocked && snap.button.status === 'connected' && (
              <p className="flex items-center gap-2 text-sm text-saffron">
                <Volume2 className="size-4" aria-hidden />
                Click anywhere on the screen once so {persona} can speak out loud.
              </p>
            )}
          </div>

          <div className="mt-auto w-full max-w-2xl pt-4">
            {showText ? (
              <TextComposer
                inputRef={inputRef}
                disabled={snap.state === 'listening'}
                onSend={(text) => conversation.sendText(text)}
                onClose={voiceInput ? () => setTyping(false) : undefined}
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setTyping(true)
                  requestAnimationFrame(() => inputRef.current?.focus())
                }}
                className="mx-auto flex items-center gap-2 rounded-full px-4 py-2 text-sm text-linen/60 transition-colors hover:bg-white/5 hover:text-linen focus-visible:ring-2 focus-visible:ring-saffron focus-visible:outline-none"
              >
                <Keyboard className="size-4" aria-hidden />
                Type instead
              </button>
            )}
          </div>
        </section>

        <aside className="flex min-w-0 flex-col gap-4 lg:max-h-[calc(100dvh-7rem)]" aria-label="Your table">
          <OrderPanel order={snap.order} allergies={snap.allergies} currency={table.currency} persona={persona} />
          <MentionedDishes dishes={snap.dishes} guestAllergens={snap.allergies?.allergens ?? []} currency={table.currency} />
        </aside>
      </main>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex min-h-dvh flex-col text-linen"
      style={{
        background:
          'radial-gradient(1200px 800px at 32% 42%, #1f4a39 0%, var(--bistro-deep) 45%, var(--bistro-night) 100%)',
      }}
    >
      {children}
    </div>
  )
}

function orbLabel(state: ButtonState, latched: boolean, voiceInput: boolean) {
  if (!voiceInput) return 'Voice is off. Type your question below.'
  switch (state) {
    case 'idle':
      return 'Hold to talk, or tap once to start'
    case 'listening':
      return latched ? 'Listening. Press again to send.' : 'Listening. Let go to send.'
    case 'thinking':
      return 'Thinking. Press to start over.'
    case 'speaking':
      return 'Speaking. Press to interrupt.'
  }
}

function StatusLine({
  state,
  latched,
  persona,
  voiceInput,
}: {
  state: ButtonState
  latched: boolean
  persona: string
  voiceInput: boolean
}) {
  if (state === 'idle') {
    if (!voiceInput) {
      return <p className="text-center font-display text-[clamp(1.25rem,2.6vw,1.9rem)] font-medium text-linen">Type your question below</p>
    }
    return <RotatingHint />
  }
  const copy = {
    listening: { title: 'Listening…', sub: latched ? 'Press again when you are done' : 'Let go when you are done' },
    thinking: { title: 'One moment…', sub: `${persona} is checking the menu` },
    speaking: { title: `${persona} is answering`, sub: 'Press the button to interrupt' },
  }[state]
  return (
    <div className="min-h-[2.6em] text-center" aria-live="polite">
      <p className="font-display text-[clamp(1.25rem,2.6vw,1.9rem)] leading-tight font-medium text-saffron">{copy.title}</p>
      <p className="mt-1 text-sm text-linen/60">{copy.sub}</p>
    </div>
  )
}

function Captions({ snap, persona }: { snap: ConversationSnapshot; persona: string }) {
  const streaming = snap.state === 'thinking' || snap.state === 'speaking'
  const empty = !snap.guestLine && !snap.waiterLine && !snap.guestPending

  if (empty) {
    return (
      <p className="max-w-xl text-center text-lg text-linen/70">
        Hi, I’m {persona}. Ask what’s good today, tell me what you feel like eating, or order straight away.
      </p>
    )
  }

  return (
    <div className="flex w-full flex-col gap-3 text-center" aria-live="polite">
      {(snap.guestLine || snap.guestPending) && (
        <p className="mx-auto max-w-xl text-lg text-linen/65">
          {snap.guestPending ? (
            <span className="inline-flex gap-1" aria-label="Transcribing">
              <span className="size-1.5 animate-bounce rounded-full bg-linen/60 [animation-delay:-0.2s]" />
              <span className="size-1.5 animate-bounce rounded-full bg-linen/60 [animation-delay:-0.1s]" />
              <span className="size-1.5 animate-bounce rounded-full bg-linen/60" />
            </span>
          ) : (
            <>“{snap.guestLine}”</>
          )}
        </p>
      )}
      {snap.waiterLine && (
        <p className="mx-auto max-w-2xl text-[clamp(1.25rem,2.1vw,1.75rem)] leading-snug font-medium text-paper">
          {snap.waiterLine}
          {streaming && <span className="ml-1 inline-block h-[1em] w-[3px] translate-y-[3px] animate-pulse rounded bg-saffron" aria-hidden />}
        </p>
      )}
    </div>
  )
}

function NoticePill({ notice, onDismiss }: { notice: NonNullable<ConversationSnapshot['notice']>; onDismiss: () => void }) {
  return (
    <button
      type="button"
      onClick={onDismiss}
      role={notice.kind === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex max-w-xl items-center gap-2 rounded-full px-4 py-2 text-left text-sm font-medium animate-in fade-in-0 zoom-in-95',
        notice.kind === 'error' && 'bg-paprika text-white',
        notice.kind === 'info' && 'bg-white/10 text-linen',
        notice.kind === 'staff' && 'bg-saffron text-ink',
      )}
    >
      {notice.kind === 'staff' && <BellRing className="size-4 shrink-0" aria-hidden />}
      {notice.text}
    </button>
  )
}

function LanguageBadge({ code }: { code: string }) {
  const name = languageName(code)
  const own = nativeLanguageName(code)
  return (
    <span className="rounded-full bg-white/10 px-3 py-1 text-sm text-linen" title="The guest's language, detected from speech">
      {name}
      {own && own.toLowerCase() !== name.toLowerCase() && <span className="text-linen/60"> ({own})</span>}
    </span>
  )
}

const TRANSPORT_LABEL: Record<ButtonTransport, string> = { usb: 'USB', bluetooth: 'Bluetooth' }

function ButtonControl({
  snap,
  onConnect,
  onDisconnect,
}: {
  snap: ConversationSnapshot
  onConnect: (transport: ButtonTransport) => void
  onDisconnect: () => void
}) {
  const { status, transport, available } = snap.button
  const quiet = 'text-linen hover:bg-white/10 hover:text-linen'

  if (status === 'unsupported') {
    return (
      <span className="text-xs text-linen/50" title="The table button needs Web Serial or Web Bluetooth (Chrome or Edge on a laptop)">
        Table button needs Chrome
      </span>
    )
  }
  if (status === 'connected' && transport) {
    return (
      <Button variant="ghost" size="sm" className={quiet} onClick={onDisconnect} title="Disconnect the table button">
        <span className="size-2 rounded-full bg-[#7fd99a]" aria-hidden />
        Button · {TRANSPORT_LABEL[transport]}
        <Unplug className="opacity-60" aria-hidden />
      </Button>
    )
  }
  if (status === 'reconnecting') {
    return (
      <Button variant="ghost" size="sm" className={quiet} onClick={onDisconnect} title="Stop reconnecting and disconnect">
        <BluetoothSearching className="animate-pulse text-saffron" aria-hidden />
        Button reconnecting…
      </Button>
    )
  }
  if (status === 'connecting') {
    return (
      <Button variant="accent" size="sm" disabled>
        <Loader2 className="animate-spin" aria-hidden />
        Connecting{transport ? ` (${TRANSPORT_LABEL[transport]})` : ''}…
      </Button>
    )
  }
  if (available.length === 1) {
    const only = available[0]
    return (
      <Button variant="accent" size="sm" onClick={() => onConnect(only)}>
        {only === 'usb' ? <Cable aria-hidden /> : <Bluetooth aria-hidden />}
        Connect table button
      </Button>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="accent" size="sm">
          <Cable aria-hidden />
          Connect table button
          <ChevronDown className="opacity-70" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onConnect('usb')}>
          <Usb aria-hidden />
          USB cable
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onConnect('bluetooth')}>
          <Bluetooth aria-hidden />
          Bluetooth (battery box)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function TextComposer({
  inputRef,
  disabled,
  onSend,
  onClose,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>
  disabled?: boolean
  onSend: (text: string) => void
  onClose?: () => void
}) {
  const [text, setText] = useState('')
  return (
    <form
      className="flex items-center gap-2 rounded-full bg-white/8 p-1.5 pl-5 ring-1 ring-white/15 focus-within:ring-2 focus-within:ring-saffron"
      onSubmit={(e) => {
        e.preventDefault()
        if (!text.trim()) return
        onSend(text)
        setText('')
      }}
    >
      <label htmlFor="guest-text" className="sr-only">
        Type your question
      </label>
      <input
        id="guest-text"
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && onClose) onClose()
        }}
        placeholder="Type in any language…"
        autoComplete="off"
        className="min-w-0 flex-1 bg-transparent py-2 text-base text-paper placeholder:text-linen/45 focus:outline-none"
      />
      <Button type="submit" variant="accent" size="icon" disabled={disabled || !text.trim()} aria-label="Send">
        <SendHorizontal aria-hidden />
      </Button>
    </form>
  )
}
