import { describe, expect, it, vi } from 'vitest'
import type { TurnEvent } from '@/api/types'
import { LineSplitter } from './lineSplitter'
import { PressController } from './pressController'
import { parseTurnLine, readTurnStream } from './turnStream'

function streamOf(chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(typeof c === 'string' ? enc.encode(c) : c)
      controller.close()
    },
  })
}

describe('LineSplitter', () => {
  it('joins lines split across chunks and strips CR', () => {
    const s = new LineSplitter()
    expect(s.push('PRE')).toEqual([])
    expect(s.push('SS\r\nREL')).toEqual(['PRESS'])
    expect(s.push('EASE\n')).toEqual(['RELEASE'])
    expect(s.flush()).toEqual([])
  })

  it('returns a trailing line without newline on flush', () => {
    const s = new LineSplitter()
    s.push('{"type":"done"}')
    expect(s.flush()).toEqual(['{"type":"done"}'])
  })
})

describe('parseTurnLine', () => {
  it('ignores blank, malformed and unknown lines', () => {
    expect(parseTurnLine('')).toBeNull()
    expect(parseTurnLine('{not json')).toBeNull()
    expect(parseTurnLine('{"type":"mystery"}')).toBeNull()
    expect(parseTurnLine('{"type":"text","delta":"Hi"}')).toEqual({ type: 'text', delta: 'Hi' })
  })
})

describe('readTurnStream', () => {
  it('emits events in order even when JSON and UTF-8 are cut mid-way', async () => {
    const bytes = new TextEncoder().encode('{"type":"text","delta":"¿Qué?"}\n')
    const cut = 22 // inside the multi-byte "é"
    const events: TurnEvent[] = []
    const outcome = await readTurnStream(
      streamOf([
        '{"type":"transcript","text":"hola","lang',
        'uage":"es"}\n',
        bytes.slice(0, cut),
        bytes.slice(cut),
        '{"type":"audio","seq":0,"mime":"audio/mpeg","b64":"AA=="}\n{"type":"done"}\n',
      ]),
      (e) => events.push(e),
    )
    expect(outcome).toBe('done')
    expect(events.map((e) => e.type)).toEqual(['transcript', 'text', 'audio', 'done'])
    expect(events[1]).toEqual({ type: 'text', delta: '¿Qué?' })
  })

  it('reports error as terminal and incomplete when the stream just stops', async () => {
    expect(await readTurnStream(streamOf(['{"type":"error","message":"boom"}\n']), () => {})).toBe('error')
    expect(await readTurnStream(streamOf(['{"type":"text","delta":"Hel']), () => {})).toBe('incomplete')
  })

  it('handles the empty-transcript case', async () => {
    const events: TurnEvent[] = []
    await readTurnStream(streamOf(['{"type":"transcript","text":"","language":null}\n{"type":"done"}']), (e) => events.push(e))
    expect(events).toEqual([{ type: 'transcript', text: '', language: null }, { type: 'done' }])
  })
})

describe('PressController', () => {
  function setup() {
    let t = 0
    const start = vi.fn()
    const stop = vi.fn()
    const pc = new PressController({ tapThresholdMs: 300, startRecording: start, stopRecording: stop, now: () => t })
    return { pc, start, stop, advance: (ms: number) => (t += ms) }
  }

  it('hold records while held', () => {
    const { pc, start, stop, advance } = setup()
    pc.press()
    expect(start).toHaveBeenCalledTimes(1)
    advance(900)
    pc.release()
    expect(stop).toHaveBeenCalledTimes(1)
    expect(pc.isLatched).toBe(false)
  })

  it('short tap latches, next tap stops, and its release is swallowed', () => {
    const { pc, start, stop, advance } = setup()
    pc.press()
    advance(120)
    pc.release()
    expect(stop).not.toHaveBeenCalled()
    expect(pc.isLatched).toBe(true)

    advance(2000)
    pc.press()
    expect(stop).toHaveBeenCalledTimes(1)
    advance(100)
    pc.release()
    expect(start).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('ignores repeated presses while down (key repeat, two sources)', () => {
    const { pc, start } = setup()
    pc.press()
    pc.press()
    pc.press()
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('reset clears a latch so the next press starts again', () => {
    const { pc, start, advance } = setup()
    pc.press()
    advance(50)
    pc.release()
    pc.reset()
    pc.press()
    expect(start).toHaveBeenCalledTimes(2)
  })
})
