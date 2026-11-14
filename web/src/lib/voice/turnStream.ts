import { errorFromResponse } from '@/api/client'
import type { TurnEvent } from '@/api/types'
import { LineSplitter } from './lineSplitter'

export type TurnInput =
  | { kind: 'audio'; audio: Blob; filename?: string }
  | { kind: 'text'; text: string; speak: boolean }

/** How the stream finished: `done`/`error` are the contract's terminal events. */
export type TurnOutcome = 'done' | 'error' | 'incomplete'

const TURN_EVENT_TYPES = new Set<TurnEvent['type']>([
  'transcript',
  'text',
  'audio',
  'dishes',
  'state',
  'waiter_called',
  'done',
  'error',
])

/** Parses one NDJSON line. Returns null for blank lines and unknown/garbled objects. */
export function parseTurnLine(line: string): TurnEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const value = JSON.parse(trimmed)
    if (value && typeof value === 'object' && TURN_EVENT_TYPES.has(value.type)) return value as TurnEvent
  } catch {
    /* ignore a malformed line rather than killing the whole turn */
  }
  return null
}

/**
 * Reads an NDJSON byte stream incrementally and calls `onEvent` for every
 * object as soon as its line is complete.
 */
export async function readTurnStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: TurnEvent) => void,
): Promise<TurnOutcome> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const lines = new LineSplitter()
  let outcome: TurnOutcome = 'incomplete'

  const handle = (line: string) => {
    const event = parseTurnLine(line)
    if (!event) return
    if (event.type === 'done') outcome = 'done'
    if (event.type === 'error') outcome = 'error'
    onEvent(event)
  }

  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      for (const line of lines.push(decoder.decode(value, { stream: true }))) handle(line)
      if (outcome !== 'incomplete') break
    }
    for (const line of lines.push(decoder.decode())) handle(line)
    for (const line of lines.flush()) handle(line)
  } finally {
    reader.releaseLock()
  }
  return outcome
}

function extensionFor(mime: string): string {
  if (mime.includes('webm')) return 'webm'
  if (mime.includes('ogg')) return 'ogg'
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return 'm4a'
  if (mime.includes('wav')) return 'wav'
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3'
  return 'webm'
}

/**
 * Sends one guest turn to POST /api/table/{token}/turn and streams the reply.
 * Throws ApiError for a non-2xx response and an AbortError if `signal` aborts
 * (barge-in) — callers treat the latter as a normal cancellation.
 */
export async function streamTurn(
  url: string,
  input: TurnInput,
  onEvent: (event: TurnEvent) => void,
  signal?: AbortSignal,
): Promise<TurnOutcome> {
  let init: RequestInit
  if (input.kind === 'audio') {
    const form = new FormData()
    const filename = input.filename ?? `turn.${extensionFor(input.audio.type)}`
    form.append('audio', input.audio, filename)
    init = { method: 'POST', body: form }
  } else {
    init = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: input.text, speak: input.speak }),
    }
  }

  const res = await fetch(url, { ...init, signal, credentials: 'same-origin' })
  if (!res.ok) throw await errorFromResponse(res)
  if (!res.body) throw new Error('The server sent an empty reply.')
  return readTurnStream(res.body, onEvent)
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}
