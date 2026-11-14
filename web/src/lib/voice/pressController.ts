export interface PressControllerOptions {
  /** Below this a press counts as a tap (latches recording on). */
  tapThresholdMs: number
  /** Begin recording. Barge-in (stopping a reply) is the caller's job. */
  startRecording: () => void
  /** Stop recording and send the clip. */
  stopRecording: () => void
  now?: () => number
}

/**
 * Turns raw press/release signals from any source (serial button, space bar,
 * pointer) into push-to-talk:
 *
 * - hold ≥ threshold: record while held, stop on release;
 * - tap < threshold: recording stays on, the next press stops it.
 *
 * Duplicate presses (key auto-repeat, two sources at once) are ignored.
 */
export class PressController {
  private options: PressControllerOptions
  private now: () => number
  private down = false
  private pressedAt = 0
  private holding = false
  private latched = false
  private swallowRelease = false

  constructor(options: PressControllerOptions) {
    this.options = options
    this.now = options.now ?? (() => performance.now())
  }

  get isLatched(): boolean {
    return this.latched
  }

  press(): void {
    if (this.down) return
    this.down = true

    if (this.latched) {
      this.latched = false
      this.swallowRelease = true
      this.options.stopRecording()
      return
    }

    this.pressedAt = this.now()
    this.holding = true
    this.options.startRecording()
  }

  release(): void {
    if (!this.down) return
    this.down = false

    if (this.swallowRelease) {
      this.swallowRelease = false
      return
    }
    if (!this.holding) return
    this.holding = false

    if (this.now() - this.pressedAt < this.options.tapThresholdMs) {
      this.latched = true
    } else {
      this.options.stopRecording()
    }
  }

  /** Forget any latched/held recording (it was stopped or cancelled elsewhere). */
  reset(): void {
    this.latched = false
    this.holding = false
    this.swallowRelease = this.down
  }
}
