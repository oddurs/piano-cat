// Turning raw hand geometry into intent: where a keystroke is, how hard, and
// how loud you are asking the room to be. Deliberately DOM-free — every rule
// in here is tuned against recorded clips in tests/, not by waving at a laptop.

import { clamp, lerpRate, type Hand, type Side, type Stroke } from './signal'

// --------------------------------------------------------------- keystrokes

/**
 * A piano keystroke is a wrist falling. We fire on the *rising edge* of
 * downward velocity rather than at the bottom of the travel: the camera is
 * already 1-2 frames behind you, so waiting for the reversal put the note a
 * further 30-50ms late and that is exactly where an instrument stops feeling
 * connected to your hands.
 *
 * Because we commit early we cannot measure the peak, so we extrapolate it
 * from the current acceleration. Being 10% out on velocity is a slightly
 * wrong dynamic; being 50ms late is a broken instrument.
 */
export class StrokeDetector {
  /** 0.4 (twitchy) .. 2.5 (needs a big deliberate stroke) */
  sensitivity = 1

  private prevY = 0
  private prevT = 0
  private has = false
  private vy = 0
  private prevVy = 0
  private peak = MIN_VY
  private armed = true
  private lastFire = -Infinity

  constructor(private side: Side) {}

  /** Feed one video frame. Returns a stroke on the frame it begins. */
  feed(t: number, y: number, present: boolean, capturedAt = t): Stroke | null {
    if (!present) { this.has = false; this.vy = 0; this.armed = true; return null }

    const dt = this.has ? t - this.prevT : 0
    if (!this.has || dt <= 0) {
      this.has = true; this.prevY = y; this.prevT = t
      return null
    }
    this.prevT = t

    const raw = (y - this.prevY) / dt
    this.prevY = y
    this.prevVy = this.vy
    // Just enough smoothing to kill landmark jitter; one camera frame's worth.
    this.vy += (raw - this.vy) * lerpRate(dt, 0.028)

    // Threshold rides your own recent peaks, so a small gesturer and a big
    // gesturer both get the same instrument.
    this.peak = Math.max(this.vy, this.peak * Math.exp(-dt / 2.4), MIN_VY)
    const thr = Math.max(MIN_VY, this.peak * 0.42) * this.sensitivity

    if (!this.armed && this.vy < thr * 0.35) this.armed = true

    if (!this.armed || this.vy <= thr) return null
    if (t - this.lastFire < MIN_GAP) return null

    this.armed = false
    this.lastFire = t

    // Where this stroke is heading, ~45ms out. That is the hammer speed.
    const accel = (this.vy - this.prevVy) / dt
    const projected = Math.max(this.vy, this.vy + accel * 0.045)
    const strength = clamp(Math.pow(projected / (thr * 1.9), 0.7), 0.14, 1)

    return { side: this.side, t, strength, x: 0, latency: Math.max(0, t - capturedAt) }
  }

  reset() { this.has = false; this.armed = true; this.vy = 0; this.peak = MIN_VY; this.lastFire = -Infinity }
}

/** frame-heights per second below which nothing counts as a deliberate stroke */
const MIN_VY = 0.62
/** fast enough for a trill, slow enough that one stroke is never two */
const MIN_GAP = 0.07

// ------------------------------------------------- fallback: no hands, just pixels

/**
 * When there is no hand model — it failed to load, the machine is too slow, or
 * you are lit from behind — we fall back to bursts in whole-frame motion.
 * Same contract, coarser truth: one stream, no idea which hand.
 *
 * Note there is no disarm gate here. The old one held the detector shut until
 * energy fell back below 45% of threshold, which is why sustained waving used
 * to produce silence. Re-arming is now purely the MIN_GAP, and anything that
 * arrives too close together becomes an ornament downstream rather than being
 * thrown away.
 */
export class EnergyDetector {
  sensitivity = 1
  private slow = 0
  private fluxMax = 0.004
  private lastFire = -Infinity

  feed(t: number, dt: number, energy: number, side: Side): Stroke | null {
    this.slow += (energy - this.slow) * lerpRate(dt, 0.3)
    const flux = Math.max(0, energy - this.slow)
    this.fluxMax = Math.max(flux, this.fluxMax * Math.exp(-dt / 1.6))
    const thr = Math.max(0.0022, this.fluxMax * 0.33) * this.sensitivity

    if (flux <= thr || t - this.lastFire < MIN_GAP) return null
    this.lastFire = t
    const strength = clamp(Math.pow(flux / Math.max(thr * 2.2, 1e-6), 0.7), 0.14, 1)
    return { side, t, strength, x: side === 'L' ? 0.35 : 0.65, latency: 0 }
  }

  reset() { this.slow = 0; this.fluxMax = 0.004; this.lastFire = -Infinity }
}

// -------------------------------------------------------------- expression

/**
 * The continuous half of playing: how loud, how high, how wide, how frantic.
 * Fast to swell and slow to subside, like a room does.
 */
export class ExpressionReader {
  sensitivity = 1
  dyn = 0
  wild = 0
  height = 0.5
  spread = 0.5
  travel = 0

  private env = 0
  private strokeGaps: number[] = []
  private lastStroke = -1

  update(dt: number, hands: Record<Side, Hand>, energy: number) {
    const seen = (['L', 'R'] as Side[]).filter((s) => hands[s].present)

    // Speed of the hands themselves is a far better read of intent than
    // whole-frame energy — a person walking behind you no longer plays forte.
    const move = seen.length
      ? seen.reduce((a, s) => a + hands[s].speed, 0) / seen.length
      : energy * 6

    this.travel += (clamp(move / 2.6, 0, 1) - this.travel) * lerpRate(dt, move > this.travel * 2.6 ? 0.05 : 0.22)

    this.env += (move - this.env) * lerpRate(dt, move > this.env ? 0.09 : 0.5)
    const ask = clamp(Math.pow(this.env / (1.5 * this.sensitivity), 0.7), 0, 1)
    this.dyn += (ask - this.dyn) * lerpRate(dt, 0.16)

    if (seen.length) {
      const hi = seen.reduce((a, s) => a + (1 - hands[s].y), 0) / seen.length
      const sp = seen.reduce((a, s) => a + hands[s].spread, 0) / seen.length
      this.height += (hi - this.height) * lerpRate(dt, 0.2)
      this.spread += (sp - this.spread) * lerpRate(dt, 0.3)
    } else {
      this.height += (0.5 - this.height) * lerpRate(dt, 0.8)
    }
  }

  /** Unevenness of your pulse, folded in with how loud you are. */
  noteStroke(t: number) {
    if (this.lastStroke > 0) {
      this.strokeGaps.push(t - this.lastStroke)
      if (this.strokeGaps.length > 8) this.strokeGaps.shift()
    }
    this.lastStroke = t
    if (this.strokeGaps.length >= 3) {
      const mean = this.strokeGaps.reduce((a, b) => a + b, 0) / this.strokeGaps.length
      const sd = Math.sqrt(this.strokeGaps.reduce((a, b) => a + (b - mean) ** 2, 0) / this.strokeGaps.length)
      this.wild = clamp(sd / mean / 0.5, 0, 1)
    }
  }

  reset() {
    this.strokeGaps = []
    this.lastStroke = -1
    this.wild = 0
    this.dyn = 0
    this.env = 0
    this.travel = 0
  }
}
