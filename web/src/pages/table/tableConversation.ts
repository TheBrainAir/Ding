import { api, turnUrl } from '@/api/client'
import type { ButtonState, Dish, GuestAllergies, Order, TableInfo, TurnEvent } from '@/api/types'
import { MAX_RECORDING_MS, TAP_THRESHOLD_MS } from '@/config'
import {
  AudioQueuePlayer,
  BluetoothButton,
  PressController,
  Recorder,
  SerialButton,
  canRecord,
  classifyMicError,
  getAudioContext,
  isAbortError,
  streamTurn,
  unlockAudio,
  type ButtonLink,
  type ButtonLinkStatus,
  type ButtonTransport,
  type MicError,
  type TurnInput,
} from '@/lib/voice'
import { InfoRotation } from './infoRotation'

export type MicStatus = 'unknown' | 'ready' | MicError
export type ButtonStatus = 'unsupported' | ButtonLinkStatus

/** The physical table button: which transport is in use and how the link is doing. */
export interface ButtonSnapshot {
  status: ButtonStatus
  /** Set while connecting / connected / reconnecting. */
  transport: ButtonTransport | null
  /** What this browser can do: Web Serial (USB cable) and/or Web Bluetooth. */
  available: ButtonTransport[]
}

const REMEMBER_KEY = 'ding.tableButton.transport'

function rememberTransport(transport: ButtonTransport | null) {
  try {
    if (transport) localStorage.setItem(REMEMBER_KEY, transport)
    else localStorage.removeItem(REMEMBER_KEY)
  } catch {
    /* storage unavailable: just no prompt-free reconnect */
  }
}

function rememberedTransport(): ButtonTransport | null {
  try {
    const value = localStorage.getItem(REMEMBER_KEY)
    return value === 'usb' || value === 'bluetooth' ? value : null
  } catch {
    return null
  }
}

function initialButton(): ButtonSnapshot {
  const available: ButtonTransport[] = []
  if (SerialButton.isSupported()) available.push('usb')
  if (BluetoothButton.isSupported()) available.push('bluetooth')
  return { status: available.length ? 'disconnected' : 'unsupported', transport: null, available }
}

export interface Notice {
  kind: 'info' | 'error' | 'staff'
  text: string
}

export interface ConversationSnapshot {
  state: ButtonState
  /** What the guest said last. */
  guestLine: string | null
  /** Waiting for the transcript of the clip just sent. */
  guestPending: boolean
  /** The waiter's reply, streamed. */
  waiterLine: string
  dishes: Dish[]
  order: Order | null
  allergies: GuestAllergies | null
  language: string | null
  notice: Notice | null
  /** A short tap latched recording on; the next press sends. */
  latched: boolean
  mic: MicStatus
  button: ButtonSnapshot
  audioLocked: boolean
  voiceEnabled: boolean
}

const MIN_CLIP_MS = 300

function initialSnapshot(): ConversationSnapshot {
  return {
    state: 'idle',
    guestLine: null,
    guestPending: false,
    waiterLine: '',
    dishes: [],
    order: null,
    allergies: null,
    language: null,
    notice: null,
    latched: false,
    mic: canRecord() ? 'unknown' : 'unsupported',
    button: initialButton(),
    audioLocked: true,
    voiceEnabled: false,
  }
}

/**
 * Everything the guest screen does, independent of React: push-to-talk from
 * three sources, one streamed turn at a time, barge-in, gapless playback and
 * the table button's display (USB cable or Bluetooth). The page renders `getSnapshot()`.
 */
export class TableConversation {
  readonly token: string
  private snap: ConversationSnapshot = initialSnapshot()
  private listeners = new Set<() => void>()
  private recorder = new Recorder()
  private player: AudioQueuePlayer
  private press: PressController
  private links: Record<ButtonTransport, ButtonLink>
  /** The transport the user chose (its status says whether it is up). */
  private link: ButtonLink | null = null
  /** True while we close a link ourselves, so it is not reported as "unplugged". */
  private closingLink = false
  private tableLabel = ''
  /** Pages LCD line 2 through the order while the button is connected. */
  private rotation = new InfoRotation((text) => void this.link?.sendInfo(text))
  private abort: AbortController | null = null
  private turnId = 0
  private voiceExpected = false
  private seeded = false
  private maxTimer: ReturnType<typeof setTimeout> | null = null
  private noticeTimer: ReturnType<typeof setTimeout> | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null

  constructor(token: string) {
    this.token = token
    this.player = new AudioQueuePlayer({
      onStart: () => {
        if (this.snap.state === 'thinking') this.set({ state: 'speaking' })
      },
      onDrained: () => this.replyFinished(),
    })
    this.press = new PressController({
      tapThresholdMs: TAP_THRESHOLD_MS,
      startRecording: () => this.startListening(),
      stopRecording: () => void this.finishListening(),
    })
    const callbacks = (transport: ButtonTransport) => ({
      onPress: () => this.pressStart(),
      onRelease: () => this.pressEnd(),
      onStatus: (status: ButtonLinkStatus) => this.onLinkStatus(transport, status),
      onReady: () => {
        if (this.link === this.links[transport]) this.rotation.resume()
      },
    })
    this.links = { usb: new SerialButton(callbacks('usb')), bluetooth: new BluetoothButton(callbacks('bluetooth')) }
  }

  // ---- store plumbing (useSyncExternalStore) ----

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = () => this.snap

  private set(patch: Partial<ConversationSnapshot>) {
    const prev = this.snap
    this.snap = { ...prev, ...patch }
    this.syncButton()
    if (patch.notice !== undefined && patch.notice !== prev.notice) this.scheduleNoticeDismiss(patch.notice)
    for (const l of this.listeners) l()
  }

  private scheduleNoticeDismiss(notice: Notice | null) {
    if (this.noticeTimer) clearTimeout(this.noticeTimer)
    this.noticeTimer = null
    if (!notice) return
    this.noticeTimer = setTimeout(
      () => {
        if (this.snap.notice === notice) this.set({ notice: null })
      },
      notice.kind === 'info' ? 6000 : 10_000,
    )
  }

  /** Read through a call so TypeScript does not keep a narrowing across awaits. */
  private stateNow(): ButtonState {
    return this.snap.state
  }

  private get voiceInput(): boolean {
    return this.snap.voiceEnabled && (this.snap.mic === 'unknown' || this.snap.mic === 'ready')
  }

  // ---- lifecycle ----

  /** Apply what GET /api/table/{token} says. Seeds the screen once per guest. */
  configure(info: TableInfo) {
    this.tableLabel = info.table_label
    const patch: Partial<ConversationSnapshot> = { voiceEnabled: info.voice_enabled }
    if (!this.seeded) {
      this.seeded = true
      const session = info.session
      const lastGuest = session?.transcript.findLast((l) => l.role === 'guest')
      const lastWaiter = session?.transcript.findLast((l) => l.role === 'waiter')
      Object.assign(patch, {
        order: session?.order ?? null,
        allergies: session?.allergies ?? null,
        language: session?.language ?? null,
        guestLine: lastGuest?.text ?? null,
        waiterLine: lastWaiter?.text ?? '',
      })
    } else if (this.snap.state === 'idle' && info.session?.order) {
      // Periodic refresh: pick up kitchen progress (placed → preparing → served).
      patch.order = info.session.order
    }
    this.set(patch)
  }

  attach() {
    this.refreshAudioLock()
    if (!this.link) void this.reconnectRememberedButton()
  }

  detach() {
    this.cancelTurn()
    this.recorder.dispose()
    this.press.reset()
    this.clearTimers()
    this.rotation.stop()
    this.closingLink = true
    void Promise.all([this.links.usb.disconnect(), this.links.bluetooth.disconnect()]).finally(() => {
      this.closingLink = false
    })
    this.link = null
    this.set({ state: 'idle', latched: false, button: initialButton() })
  }

  private clearTimers() {
    for (const t of [this.maxTimer, this.noticeTimer, this.idleTimer]) if (t) clearTimeout(t)
    this.maxTimer = this.noticeTimer = this.idleTimer = null
  }

  /** Any user gesture on the page lets the browser play sound. */
  unlock() {
    void unlockAudio().then(() => this.refreshAudioLock())
  }

  private refreshAudioLock() {
    const locked = getAudioContext().state !== 'running'
    if (locked !== this.snap.audioLocked) this.set({ audioLocked: locked })
  }

  // ---- press sources: pointer, space bar, table button ----

  pressStart = () => {
    this.unlock()
    this.press.press()
    this.set({ latched: this.press.isLatched })
  }

  pressEnd = () => {
    this.press.release()
    this.set({ latched: this.press.isLatched })
  }

  // ---- the table button (USB cable or Bluetooth) ----

  /** Tell the button what to show: state on LCD line 1 (or the Uno's LED), the order on line 2. */
  private syncButton() {
    this.rotation.update(this.snap.order, this.tableLabel)
    const link = this.link
    if (link?.connected) void link.sendState(this.snap.state)
  }

  private onLinkStatus(transport: ButtonTransport, status: ButtonLinkStatus) {
    if (this.link !== this.links[transport]) return // not the button in use
    const prev = this.snap.button.status
    let notice: Notice | null | undefined
    if (status === 'reconnecting') {
      notice = { kind: 'info', text: 'The table button lost its Bluetooth link. Reconnecting…' }
    } else if (status === 'connected' && prev === 'reconnecting') {
      notice = { kind: 'info', text: 'The table button is back.' }
    } else if (status === 'disconnected' && !this.closingLink && (prev === 'connected' || prev === 'reconnecting')) {
      notice = {
        kind: 'info',
        text: transport === 'usb' ? 'The table button was unplugged.' : 'The table button disconnected.',
      }
    }
    const button: ButtonSnapshot = {
      ...this.snap.button,
      status,
      transport: status === 'disconnected' ? null : transport,
    }
    this.set(notice === undefined ? { button } : { button, notice })
    if (status === 'connected') this.rotation.resume()
    else this.rotation.stop()
  }

  /** On page load: reopen the button used last time, without a prompt, if the browser allows. */
  private async reconnectRememberedButton() {
    const last = rememberedTransport()
    if (!last) return
    const order: ButtonTransport[] = last === 'bluetooth' ? ['bluetooth', 'usb'] : ['usb', 'bluetooth']
    for (const transport of order) {
      if (!this.snap.button.available.includes(transport)) continue
      const link = this.links[transport]
      this.link = link
      const ok = await link.reconnectKnown().catch(() => false)
      if (this.link !== link) return // the user connected something else meanwhile
      if (ok) {
        this.syncButton()
        return
      }
    }
    if (this.link && !this.link.connected) this.link = null
  }

  async connectButton(transport: ButtonTransport) {
    this.unlock()
    const link = this.links[transport]
    const previous = this.link
    if (previous && previous !== link) {
      this.closingLink = true
      try {
        await previous.disconnect()
      } finally {
        this.closingLink = false
      }
    }
    this.link = link
    this.set({ button: { ...this.snap.button, status: 'connecting', transport } })
    try {
      await link.connect()
      rememberTransport(transport)
      this.set({
        button: { ...this.snap.button, status: link.status, transport },
        notice: {
          kind: 'info',
          text: `Table button connected over ${transport === 'usb' ? 'the USB cable' : 'Bluetooth'}. Press it to talk.`,
        },
      })
      if (this.snap.voiceEnabled && this.snap.mic === 'unknown') void this.warmMic()
    } catch (err) {
      if (this.link === link) this.link = null
      const cancelled = err instanceof DOMException && err.name === 'NotFoundError'
      this.set({
        button: { ...this.snap.button, status: 'disconnected', transport: null },
        notice: cancelled ? null : { kind: 'error', text: `Could not connect the table button: ${(err as Error).message}` },
      })
    }
  }

  async disconnectButton() {
    const link = this.link
    this.link = null
    this.rotation.stop()
    rememberTransport(null)
    if (link) {
      this.closingLink = true
      try {
        await link.disconnect()
      } finally {
        this.closingLink = false
      }
    }
    this.set({ button: { ...this.snap.button, status: 'disconnected', transport: null } })
  }

  /** Ask for the mic up front so the first button press records straight away. */
  private async warmMic() {
    try {
      await this.recorder.ensureStream()
      this.set({ mic: 'ready' })
    } catch (err) {
      this.set({ mic: classifyMicError(err) })
    }
  }

  // ---- recording ----

  private startListening() {
    if (!this.voiceInput) {
      this.press.reset()
      this.set({
        notice: {
          kind: 'info',
          text: this.snap.voiceEnabled ? 'The microphone is off. Type your question below.' : 'Voice is off at this table. Type your question below.',
        },
      })
      return
    }

    // Barge-in: stop the reply mid-sentence and listen.
    if (this.snap.state === 'thinking' || this.snap.state === 'speaking') this.cancelTurn()
    if (this.idleTimer) clearTimeout(this.idleTimer)

    this.set({ state: 'listening', notice: null })
    if (this.maxTimer) clearTimeout(this.maxTimer)
    this.maxTimer = setTimeout(() => void this.finishListening(), MAX_RECORDING_MS)

    this.recorder.start().then(
      () => {
        if (this.snap.mic !== 'ready') this.set({ mic: 'ready' })
      },
      (err) => {
        if (this.snap.state !== 'listening') return
        if (this.maxTimer) clearTimeout(this.maxTimer)
        this.press.reset()
        const mic = classifyMicError(err)
        this.set({
          state: 'idle',
          latched: false,
          mic,
          notice: {
            kind: 'error',
            text:
              mic === 'blocked'
                ? 'Microphone access is blocked. Allow it from the address bar, or type below.'
                : 'No microphone is available. Type your question below.',
          },
        })
      },
    )
  }

  private async finishListening() {
    if (this.maxTimer) clearTimeout(this.maxTimer)
    this.maxTimer = null
    this.press.reset()
    if (this.snap.state !== 'listening') return

    this.set({ state: 'thinking', latched: false, guestPending: true })
    const recording = await this.recorder.stop()
    if (this.stateNow() !== 'thinking' || this.abort) return // the guest pressed again or typed meanwhile

    if (!recording || recording.durationMs < MIN_CLIP_MS) {
      this.set({
        state: 'idle',
        guestPending: false,
        notice: { kind: 'info', text: 'Hold the button while you talk, or tap once to start and once more to send.' },
      })
      return
    }
    void this.runTurn({ kind: 'audio', audio: recording.blob })
  }

  // ---- turns ----

  sendText(text: string) {
    const clean = text.trim()
    if (!clean) return
    this.unlock()
    this.recorder.cancel()
    this.press.reset()
    void this.runTurn({ kind: 'text', text: clean, speak: this.snap.voiceEnabled })
  }

  private cancelTurn() {
    this.turnId++
    this.abort?.abort()
    this.abort = null
    this.player.flush()
    if (this.idleTimer) clearTimeout(this.idleTimer)
  }

  private async runTurn(input: TurnInput) {
    this.cancelTurn()
    const id = this.turnId
    const abort = new AbortController()
    this.abort = abort
    this.voiceExpected = input.kind === 'audio' ? this.snap.voiceEnabled : input.speak
    this.player.begin()

    let waiterText = ''
    let heardNothing = false

    this.set({
      state: 'thinking',
      waiterLine: '',
      latched: false,
      notice: null,
      guestPending: input.kind === 'audio',
      guestLine: input.kind === 'text' ? input.text : this.snap.guestLine,
    })

    const onEvent = (event: TurnEvent) => {
      if (id !== this.turnId) return
      switch (event.type) {
        case 'transcript':
          if (!event.text.trim()) {
            heardNothing = true
            this.set({ guestPending: false })
          } else {
            this.set({ guestLine: event.text, guestPending: false, language: event.language ?? this.snap.language })
          }
          break
        case 'text':
          waiterText += event.delta
          this.set({
            waiterLine: waiterText,
            state: !this.voiceExpected && this.snap.state === 'thinking' ? 'speaking' : this.snap.state,
          })
          break
        case 'audio':
          this.player.enqueue(event.seq, event.b64)
          break
        case 'dishes':
          if (event.dishes.length) this.set({ dishes: event.dishes })
          break
        case 'state':
          this.set({ order: event.order, allergies: event.allergies, language: event.language ?? this.snap.language })
          break
        case 'waiter_called':
          this.set({ notice: { kind: 'staff', text: 'A member of staff is on the way to your table.' } })
          break
        case 'error':
          this.set({ notice: { kind: 'error', text: event.message || 'Something went wrong. Press the button to try again.' } })
          break
        case 'done':
          break
      }
    }

    try {
      const outcome = await streamTurn(turnUrl(this.token), input, onEvent, abort.signal)
      if (id !== this.turnId) return
      this.abort = null
      if (heardNothing) {
        this.player.flush()
        this.set({
          state: 'idle',
          guestPending: false,
          notice: { kind: 'info', text: "Sorry, I didn't catch that. Press the button and try again." },
        })
        return
      }
      if (outcome === 'incomplete') {
        this.set({ notice: { kind: 'error', text: 'The reply was cut off. Press the button to try again.' } })
      }
      this.set({ guestPending: false })
      this.player.endOfStream()
    } catch (err) {
      if (isAbortError(err) || id !== this.turnId) return
      this.abort = null
      this.player.flush()
      this.set({
        state: 'idle',
        guestPending: false,
        notice: { kind: 'error', text: (err as Error)?.message || 'Something went wrong. Press the button to try again.' },
      })
    }
  }

  private replyFinished() {
    if (this.snap.state !== 'thinking' && this.snap.state !== 'speaking') return
    this.refreshAudioLock()
    if (this.voiceExpected) {
      this.set({ state: 'idle' })
      return
    }
    // Text-only replies: let "speaking" register for a moment before going idle.
    const id = this.turnId
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => {
      if (id === this.turnId && (this.snap.state === 'speaking' || this.snap.state === 'thinking')) this.set({ state: 'idle' })
    }, 900)
  }

  // ---- new guest ----

  async reset() {
    this.cancelTurn()
    this.recorder.cancel()
    this.press.reset()
    this.clearTimers()
    const { mic, button, audioLocked, voiceEnabled } = this.snap
    this.snap = { ...initialSnapshot(), mic, button, audioLocked, voiceEnabled }
    this.seeded = true // a new guest starts blank; do not re-seed from the old session
    this.syncButton()
    for (const l of this.listeners) l()
    try {
      await api.resetTable(this.token)
    } catch (err) {
      this.set({ notice: { kind: 'error', text: `Could not start a new guest: ${(err as Error).message}` } })
    }
  }

  /** Live level for the orb animation. */
  level = () => (this.snap.state === 'listening' ? this.recorder.level() : this.player.level())

  /** Remove the notice now. */
  dismissNotice() {
    this.set({ notice: null })
  }
}
