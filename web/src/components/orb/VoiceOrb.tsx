import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Keyboard, Mic } from 'lucide-react'
import type { ButtonState } from '@/api/types'
import './voice-orb.css'

const BAR_COUNT = 60
const WAVE_COUNT = 5

// Deterministic per-bar variety so the ring never looks like a uniform pulse.
const bars = Array.from({ length: BAR_COUNT }, (_, i) => ({
  a: `${(i * 360) / BAR_COUNT}deg`,
  k: (0.55 + 0.9 * Math.abs(Math.sin(i * 12.9898) * 0.5 + Math.sin(i * 3.7) * 0.5)).toFixed(3),
  d: `${-((i * 97) % 700)}ms`,
}))
const wave = Array.from({ length: WAVE_COUNT }, (_, i) => ({
  k: [0.55, 0.85, 1, 0.8, 0.5][i],
  d: `${-i * 110}ms`,
}))

export interface VoiceOrbProps {
  state: ButtonState
  /** Live 0..1 amplitude: the mic while listening, the reply while speaking. */
  getLevel?: () => number
  onPressStart: () => void
  onPressEnd: () => void
  label: string
  disabled?: boolean
  /** Diameter of the button cap, any CSS length. */
  size?: string
  /** 'text' when the guest has to type (voice off or no microphone). */
  inputMode?: 'voice' | 'text'
}

/**
 * The on-screen twin of the button on the table. Pointer down/up map to the
 * same press/release signals as the physical button and the space bar.
 */
export function VoiceOrb({ state, getLevel, onPressStart, onPressEnd, label, disabled, size, inputMode = 'voice' }: VoiceOrbProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const levelSource = useRef(getLevel)
  const stateRef = useRef(state)
  const [pressing, setPressing] = useState(false)

  useEffect(() => {
    levelSource.current = getLevel
    stateRef.current = state
  }, [getLevel, state])

  useEffect(() => {
    let raf = 0
    let smooth = 0
    const tick = (now: number) => {
      const current = stateRef.current
      let target = 0
      if (current === 'listening' || current === 'speaking') {
        target = levelSource.current?.() ?? 0
        // No signal (mic warming up, text-only reply, locked audio): fake a gentle one.
        if (current === 'speaking' && target < 0.03) {
          target = 0.35 + 0.3 * Math.sin(now / 95) * Math.sin(now / 410)
        } else if (current === 'listening' && target < 0.02) {
          target = 0.06 + 0.04 * Math.sin(now / 320)
        }
      }
      smooth += (target - smooth) * (target > smooth ? 0.45 : 0.12)
      stageRef.current?.style.setProperty('--level', smooth.toFixed(3))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const end = () => {
    setPressing(false)
    onPressEnd()
  }

  return (
    <div
      ref={stageRef}
      className="orb"
      data-state={state}
      data-pressing={pressing}
      style={size ? ({ '--size': size } as CSSProperties) : undefined}
    >
      <div className="orb-halo" />
      <div className="orb-ripple" />
      <div className="orb-ripple" />
      <div className="orb-ripple" />
      <div className="orb-orbit" />
      <div className="orb-orbit is-inner" />
      <div className="orb-bars" aria-hidden>
        {bars.map((b, i) => (
          <span key={i} className="orb-bar" style={{ '--a': b.a, '--k': b.k, '--d': b.d } as CSSProperties} />
        ))}
      </div>
      <button
        type="button"
        className="orb-housing"
        aria-label={label}
        aria-pressed={state === 'listening'}
        disabled={disabled}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.currentTarget.setPointerCapture(e.pointerId)
          setPressing(true)
          onPressStart()
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={() => setPressing(false)}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          // Space is handled page-wide; keep Enter working for keyboard users.
          if (e.key === 'Enter' && !e.repeat) {
            e.preventDefault()
            onPressStart()
          }
        }}
        onKeyUp={(e) => {
          if (e.key === 'Enter') onPressEnd()
        }}
      >
        <span className="orb-cap">
          <span className="orb-glint" />
          <span className="orb-glyph is-mic">{inputMode === 'text' ? <Keyboard /> : <Mic />}</span>
          <span className="orb-glyph is-dots">
            <span className="orb-dots">
              <span />
              <span />
              <span />
            </span>
          </span>
          <span className="orb-glyph is-wave">
            <span className="orb-wave">
              {wave.map((w, i) => (
                <span key={i} style={{ '--k': w.k, '--d': w.d } as CSSProperties} />
              ))}
            </span>
          </span>
        </span>
      </button>
    </div>
  )
}
