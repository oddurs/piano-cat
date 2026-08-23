// Camera observations in, playable intent out. Nothing in this file touches
// the DOM, so the exact same code path runs against a live webcam and against
// a clip recorded by lib/capture.ts — which is the only reason any of the
// thresholds below can be tuned honestly.

import { EnergyDetector, ExpressionReader, StrokeDetector } from './onset'
import {
  clamp, lerpRate, restingHand, SIDES,
  type Hand, type PlayFrame, type Side, type Stroke,
} from './signal'

/** One video frame's worth of raw observation, in mirrored display space. */
export type Observation = {
  x: number       // 0..1 palm centre across the frame
  y: number       // 0..1 palm centre, 0 = top
  sy: number      // 0..1 the point a keystroke actually moves (fingertips)
  spread: number  // 0..1 thumb-to-pinky span, normalised by palm size
  conf: number
}

export type Sample = {
  t: number          // seconds, our clock
  capturedAt: number // seconds, when the camera exposed this frame
  hands: Observation[]
  energy: number     // 0..1 whole-frame movement, for the fallback path
}

const BLANK = new Uint8Array(1)
/** a hand unseen for longer than this has left the instrument */
const GONE_AFTER = 0.5
/** the range a hand is assumed to move through before we know any better */
const DEFAULT_TOP = 0.28
const DEFAULT_BOTTOM = 0.7
/** below this the pedal would be a hair trigger */
const MIN_SPAN = 0.2

export class Perception {
  sensitivity = 1
  /** true once we have actually seen a hand; false means we are on pixels alone */
  tracked = false

  private hands: Record<Side, Hand> = { L: restingHand('L'), R: restingHand('R') }
  private strokers: Record<Side, StrokeDetector> = { L: new StrokeDetector('L'), R: new StrokeDetector('R') }
  private energy = new EnergyDetector()
  private expr = new ExpressionReader()
  private lastSeen: Record<Side, number> = { L: -Infinity, R: -Infinity }
  private lastStroke: Record<Side, number> = { L: -Infinity, R: -Infinity }
  private prev: Record<Side, { x: number; y: number; t: number } | null> = { L: null, R: null }
  private lastT = -1
  private fallbackSide: Side = 'R'

  // Where your hands live, in this room, in this chair. Learned continuously
  // rather than in a calibration screen: a gate that has to be passed before
  // you may hear anything is a bad trade for a measurement that can just as
  // well be taken while you play, and this one also follows you if you shift
  // in your seat halfway through.
  private top = DEFAULT_TOP
  private bottom = DEFAULT_BOTTOM

  private learn(dt: number, y: number) {
    // Reach somewhere new and the range takes it almost at once; stop going
    // there and it forgets over about half a minute. Both rates are stated in
    // time rather than in frames — a fast 0.4-per-frame blend converges twice
    // as quickly at 120Hz as at 60, which made the pedal feel different on
    // different machines for no reason anybody could have guessed at.
    if (y < this.top) this.top += (y - this.top) * lerpRate(dt, 0.03)
    else this.top += (DEFAULT_TOP - this.top) * lerpRate(dt, 30)
    if (y > this.bottom) this.bottom += (y - this.bottom) * lerpRate(dt, 0.03)
    else this.bottom += (DEFAULT_BOTTOM - this.bottom) * lerpRate(dt, 30)

    const span = this.bottom - this.top
    if (span < MIN_SPAN) {                     // barely moved; keep it playable
      const mid = (this.top + this.bottom) / 2
      this.top = mid - MIN_SPAN / 2
      this.bottom = mid + MIN_SPAN / 2
    }
  }

  /** 0 (hands at your lap) .. 1 (hands up) for this room, not some average room. */
  private heightOf(y: number) {
    return clamp(1 - (y - this.top) / Math.max(0.08, this.bottom - this.top), 0, 1)
  }

  ingest(s: Sample, pixels: Uint8Array = BLANK, mask: Uint8Array = BLANK): PlayFrame {
    const dt = this.lastT < 0 ? 1 / 60 : clamp(s.t - this.lastT, 1 / 240, 0.1)
    this.lastT = s.t

    // Hands are named by where they are, not by MediaPipe's anatomy call: the
    // hand on the left of your mirrored picture is the one over the bass, and
    // that is the only mapping that matches what you see on screen.
    const seen = [...s.hands].sort((a, b) => a.x - b.x)
    const assigned: Partial<Record<Side, Observation>> = {}
    if (seen.length >= 2) { assigned.L = seen[0]; assigned.R = seen[seen.length - 1] }
    else if (seen.length === 1) {
      // With one hand there is no left-and-right to sort, so a hand hovering
      // near the middle would flip sides frame to frame and the staff it plays
      // would flip with it. Keep whichever side it already was.
      const o = seen[0]
      const near = (side: Side) => (this.prev[side] ? Math.abs(this.prev[side]!.x - o.x) : Infinity)
      const dl = near('L'), dr = near('R')
      assigned[dl === Infinity && dr === Infinity ? (o.x < 0.5 ? 'L' : 'R') : dl <= dr ? 'L' : 'R'] = o
    }

    const strokes: Stroke[] = []

    for (const side of SIDES) {
      const o = assigned[side]
      const h = this.hands[side]
      if (o) {
        this.tracked = true
        this.lastSeen[side] = s.t
        this.learn(dt, o.y)
        const p = this.prev[side]
        const gap = p ? Math.max(1e-3, s.t - p.t) : 0
        const sp = p ? Math.hypot(o.x - p.x, o.y - p.y) / gap : 0
        h.present = true
        h.conf = o.conf
        h.x = o.x
        h.y = o.y
        h.spread = o.spread
        h.speed += (Math.min(sp, 8) - h.speed) * lerpRate(dt, 0.05)
        h.vy = p ? (o.y - p.y) / gap : 0
        this.prev[side] = { x: o.x, y: o.y, t: s.t }

        this.strokers[side].sensitivity = this.sensitivity
        const hit = this.strokers[side].feed(s.t, o.sy, true, s.capturedAt)
        if (hit) strokes.push({ ...hit, x: o.x })
      } else {
        const gone = s.t - this.lastSeen[side] > GONE_AFTER
        if (gone) {
          h.present = false
          h.speed += (0 - h.speed) * lerpRate(dt, 0.2)
          h.vy = 0
          this.prev[side] = null
          this.strokers[side].reset()
        }
      }
      h.lastStroke = s.t - this.lastStroke[side]
    }

    // No hands anywhere? Fall back to whole-frame motion, alternating sides so
    // the two staves still both get played.
    if (!this.hasAnyHand(s.t)) {
      this.tracked = false
      this.energy.sensitivity = this.sensitivity
      const hit = this.energy.feed(s.t, dt, s.energy, this.fallbackSide)
      if (hit) {
        this.fallbackSide = this.fallbackSide === 'L' ? 'R' : 'L'
        strokes.push(hit)
      }
    }

    for (const st of strokes) {
      this.lastStroke[st.side] = st.t
      this.hands[st.side].lastStroke = 0
      this.expr.noteStroke(st.t)
    }

    this.expr.sensitivity = this.sensitivity
    this.expr.update(dt, this.hands, s.energy)

    const anyPresent = this.hands.L.present || this.hands.R.present
    const heights = SIDES.filter((x) => this.hands[x].present).map((x) => this.heightOf(this.hands[x].y))
    const height = heights.length ? heights.reduce((a, b) => a + b, 0) / heights.length : this.expr.height

    return {
      t: s.t,
      hands: this.hands,
      strokes,
      tracked: this.tracked && anyPresent,
      energy: s.energy,
      dyn: this.expr.dyn,
      wild: this.expr.wild,
      height,
      spread: this.expr.spread,
      travel: this.expr.travel,
      pixels,
      motionMask: mask,
    }
  }

  private hasAnyHand(t: number) {
    return SIDES.some((s) => t - this.lastSeen[s] <= GONE_AFTER)
  }

  reset() {
    for (const s of SIDES) {
      this.strokers[s].reset()
      this.prev[s] = null
      this.lastSeen[s] = -Infinity
      this.lastStroke[s] = -Infinity
      this.hands[s] = restingHand(s)
    }
    this.energy.reset()
    this.expr.reset()
    this.tracked = false
    this.lastT = -1
    this.top = DEFAULT_TOP
    this.bottom = DEFAULT_BOTTOM
  }
}
