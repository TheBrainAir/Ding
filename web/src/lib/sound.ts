import { getAudioContext, unlockAudio } from './voice/audioContext'

function bell(ctx: AudioContext, freq: number, at: number, length = 1.2, gain = 0.25) {
  // A service-bell strike: a bright fundamental plus an inharmonic partial, fast attack, long decay.
  const out = ctx.createGain()
  out.gain.setValueAtTime(0.0001, at)
  out.gain.exponentialRampToValueAtTime(gain, at + 0.008)
  out.gain.exponentialRampToValueAtTime(0.0001, at + length)
  out.connect(ctx.destination)
  for (const [ratio, level] of [
    [1, 1],
    [2.76, 0.35],
    [5.4, 0.12],
  ] as const) {
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq * ratio
    g.gain.value = level
    osc.connect(g).connect(out)
    osc.start(at)
    osc.stop(at + length)
  }
}

/** Two strikes: a new order hit the kitchen. */
export async function playNewOrderSound(): Promise<void> {
  if (!(await unlockAudio())) return
  const ctx = getAudioContext()
  const t = ctx.currentTime + 0.02
  bell(ctx, 1318.5, t)
  bell(ctx, 1046.5, t + 0.18)
}

/** Three quick strikes: a table asked for a person. */
export async function playWaiterCallSound(): Promise<void> {
  if (!(await unlockAudio())) return
  const ctx = getAudioContext()
  const t = ctx.currentTime + 0.02
  bell(ctx, 987.8, t, 0.6, 0.2)
  bell(ctx, 987.8, t + 0.16, 0.6, 0.2)
  bell(ctx, 987.8, t + 0.32, 0.9, 0.2)
}

export function audioUnlocked(): boolean {
  return getAudioContext().state === 'running'
}
