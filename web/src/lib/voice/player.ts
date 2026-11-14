import { analyserLevel, getAudioContext } from './audioContext'

export interface PlayerCallbacks {
  /** First sound of the current reply actually started. */
  onStart?: () => void
  /** The reply finished: the stream has ended and every queued clip has played. */
  onDrained?: () => void
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

type Slot = AudioBuffer | 'failed'

/**
 * Plays per-sentence audio clips strictly in `seq` order with no gaps or
 * overlaps: clips are decoded as they arrive (possibly out of order) and
 * scheduled back-to-back on one Web Audio timeline.
 *
 * `flush()` (barge-in, new turn) stops everything immediately and makes any
 * decode still in flight from the old reply land nowhere.
 */
export class AudioQueuePlayer {
  private generation = 0
  private slots = new Map<number, Slot>()
  private nextSeq = 0
  private playhead = 0
  private active = new Set<AudioBufferSourceNode>()
  private decoding = 0
  private streamEnded = false
  private started = false
  private watchdog: ReturnType<typeof setTimeout> | null = null
  private output: GainNode | null = null
  private analyser: AnalyserNode | null = null
  private scratch: Float32Array<ArrayBuffer> | null = null
  private callbacks: PlayerCallbacks

  constructor(callbacks: PlayerCallbacks = {}) {
    this.callbacks = callbacks
  }

  setCallbacks(callbacks: PlayerCallbacks) {
    this.callbacks = callbacks
  }

  /** True while a reply is being played or is still expected to play. */
  get busy(): boolean {
    return this.active.size > 0 || this.slots.size > 0 || this.decoding > 0
  }

  private ensureGraph(ctx: AudioContext) {
    if (this.output && this.output.context === ctx) return
    this.output = ctx.createGain()
    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = 1024
    this.scratch = new Float32Array(this.analyser.fftSize)
    this.output.connect(this.analyser)
    this.analyser.connect(ctx.destination)
  }

  /** Output level 0..1 for the speaking animation. */
  level(): number {
    if (!this.analyser || !this.scratch || this.active.size === 0) return 0
    return analyserLevel(this.analyser, this.scratch)
  }

  /** Starts a fresh reply. Clips are expected from seq 0. */
  begin(): void {
    this.flush()
  }

  /** Queue clip `seq` (base64 audio in any format the browser decodes). */
  enqueue(seq: number, b64: string): void {
    const generation = this.generation
    const ctx = getAudioContext()
    this.ensureGraph(ctx)
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)

    let bytes: Uint8Array<ArrayBuffer>
    try {
      bytes = base64ToBytes(b64)
    } catch {
      this.slots.set(seq, 'failed')
      this.pump()
      return
    }

    this.decoding++
    ctx
      .decodeAudioData(bytes.buffer)
      .then(
        (buffer) => {
          if (generation === this.generation) this.slots.set(seq, buffer)
        },
        () => {
          if (generation === this.generation) this.slots.set(seq, 'failed')
        },
      )
      .finally(() => {
        if (generation !== this.generation) return
        this.decoding--
        this.pump()
      })
  }

  /** No more clips will arrive for this reply. */
  endOfStream(): void {
    this.streamEnded = true
    this.pump()
  }

  private pump() {
    const ctx = getAudioContext()

    // Once the stream is over, a missing seq will never arrive: skip the hole.
    if (this.streamEnded && this.decoding === 0 && !this.slots.has(this.nextSeq) && this.slots.size > 0) {
      this.nextSeq = Math.min(...this.slots.keys())
    }

    while (this.slots.has(this.nextSeq)) {
      const slot = this.slots.get(this.nextSeq)!
      this.slots.delete(this.nextSeq)
      this.nextSeq++
      if (slot === 'failed') continue
      this.schedule(ctx, slot)
    }

    this.checkDrained()
  }

  private schedule(ctx: AudioContext, buffer: AudioBuffer) {
    this.ensureGraph(ctx)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(this.output!)
    const startAt = Math.max(ctx.currentTime + 0.03, this.playhead)
    source.start(startAt)
    this.playhead = startAt + buffer.duration
    this.active.add(source)
    source.onended = () => {
      this.active.delete(source)
      source.disconnect()
      this.checkDrained()
    }
    if (!this.started) {
      this.started = true
      this.callbacks.onStart?.()
    }
    this.armWatchdog(ctx)
  }

  /**
   * If the context never runs (no user gesture yet) `onended` never fires.
   * The watchdog guarantees the UI returns to idle anyway.
   */
  private armWatchdog(ctx: AudioContext) {
    if (this.watchdog) clearTimeout(this.watchdog)
    const remaining = Math.max(0, this.playhead - ctx.currentTime)
    const generation = this.generation
    this.watchdog = setTimeout(() => {
      if (generation !== this.generation) return
      if (this.streamEnded) this.finish()
      else this.armWatchdog(ctx)
    }, (remaining + 2) * 1000)
  }

  private checkDrained() {
    if (this.streamEnded && this.active.size === 0 && this.slots.size === 0 && this.decoding === 0) {
      this.finish()
    }
  }

  private finish() {
    const hadReply = this.streamEnded
    this.stopAll()
    this.streamEnded = false
    this.started = false
    if (hadReply) this.callbacks.onDrained?.()
  }

  private stopAll() {
    if (this.watchdog) clearTimeout(this.watchdog)
    this.watchdog = null
    for (const source of this.active) {
      source.onended = null
      try {
        source.stop()
      } catch {
        /* already stopped */
      }
      source.disconnect()
    }
    this.active.clear()
    this.slots.clear()
    this.decoding = 0
    this.nextSeq = 0
    this.playhead = 0
  }

  /** Stops playback now and forgets everything queued. Does not call onDrained. */
  flush(): void {
    this.generation++
    this.stopAll()
    this.streamEnded = false
    this.started = false
  }
}
