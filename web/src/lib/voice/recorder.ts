import { analyserLevel, getAudioContext } from './audioContext'

export interface Recording {
  blob: Blob
  mime: string
  durationMs: number
}

export type MicError = 'blocked' | 'missing' | 'unsupported'

const PREFERRED_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']

export function pickRecordingMime(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  return PREFERRED_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
}

export function canRecord(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined'
  )
}

/** Maps a getUserMedia/MediaRecorder failure to something the UI can explain. */
export function classifyMicError(err: unknown): MicError {
  const name = err instanceof DOMException ? err.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'blocked'
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError') return 'missing'
  return 'unsupported'
}

interface Take {
  recorder: MediaRecorder
  chunks: Blob[]
  startedAt: number
}

/**
 * Push-to-talk recorder. The microphone stream is opened once and kept, so
 * the first syllable is not lost to device start-up on every press. Every
 * take owns its own chunk list, so a new take can start while the previous
 * one is still finalising (barge-in).
 */
export class Recorder {
  private stream: MediaStream | null = null
  private streamPromise: Promise<MediaStream> | null = null
  private take: Take | null = null
  private starting: Promise<void> | null = null
  private generation = 0
  private analyser: AnalyserNode | null = null
  private scratch: Float32Array<ArrayBuffer> | null = null

  get isRecording(): boolean {
    return this.take?.recorder.state === 'recording'
  }

  /** Opens the microphone (asks for permission the first time). */
  async ensureStream(): Promise<MediaStream> {
    if (this.stream && this.stream.getAudioTracks().some((t) => t.readyState === 'live')) return this.stream
    if (!this.streamPromise) {
      this.streamPromise = navigator.mediaDevices
        .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
        .then((stream) => {
          this.stream = stream
          this.attachMeter(stream)
          return stream
        })
        .finally(() => {
          this.streamPromise = null
        })
    }
    return this.streamPromise
  }

  private attachMeter(stream: MediaStream) {
    try {
      const ctx = getAudioContext()
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      source.connect(analyser)
      this.analyser = analyser
      this.scratch = new Float32Array(analyser.fftSize)
    } catch {
      this.analyser = null
    }
  }

  /** Current input level 0..1 for the listening animation. */
  level(): number {
    if (!this.analyser || !this.scratch || !this.isRecording) return 0
    return analyserLevel(this.analyser, this.scratch)
  }

  start(): Promise<void> {
    if (this.starting) return this.starting
    const generation = ++this.generation
    this.starting = (async () => {
      const stream = await this.ensureStream()
      if (generation !== this.generation) return // cancelled while the mic was opening
      const mime = pickRecordingMime()
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 64_000 } : undefined)
      const take: Take = { recorder, chunks: [], startedAt: performance.now() }
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) take.chunks.push(e.data)
      }
      recorder.start(250)
      this.take = take
    })().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  /** Stops and returns the clip, or null if nothing was captured. */
  async stop(): Promise<Recording | null> {
    if (this.starting) {
      try {
        await this.starting
      } catch {
        return null
      }
    }
    const take = this.take
    this.take = null
    if (!take || take.recorder.state === 'inactive') return null

    const durationMs = performance.now() - take.startedAt
    await new Promise<void>((resolve) => {
      take.recorder.onstop = () => resolve()
      take.recorder.stop()
    })
    const mime = take.recorder.mimeType || pickRecordingMime() || 'audio/webm'
    const blob = new Blob(take.chunks, { type: mime })
    if (blob.size === 0) return null
    return { blob, mime, durationMs }
  }

  /** Drops the current take without returning it. */
  cancel(): void {
    this.generation++
    const take = this.take
    this.take = null
    if (take && take.recorder.state !== 'inactive') {
      take.recorder.ondataavailable = null
      take.recorder.stop()
    }
  }

  /** Releases the microphone entirely (page unmount). */
  dispose(): void {
    this.cancel()
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.analyser = null
  }
}
