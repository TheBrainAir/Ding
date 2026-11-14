let shared: AudioContext | null = null

/** One AudioContext for the whole page (mic metering and reply playback). */
export function getAudioContext(): AudioContext {
  if (!shared || shared.state === 'closed') shared = new AudioContext()
  return shared
}

/**
 * Browsers start an AudioContext suspended until the page has had a user
 * gesture. Call this from click/keydown handlers; it is cheap when already running.
 */
export async function unlockAudio(): Promise<boolean> {
  const ctx = getAudioContext()
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume()
    } catch {
      /* still locked — playback falls back to captions only */
    }
  }
  return ctx.state === 'running'
}

/** RMS level (0..1) of an analyser's current time-domain frame. */
export function analyserLevel(analyser: AnalyserNode, scratch: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(scratch)
  let sum = 0
  for (let i = 0; i < scratch.length; i++) sum += scratch[i] * scratch[i]
  return Math.min(1, Math.sqrt(sum / scratch.length) * 3)
}
