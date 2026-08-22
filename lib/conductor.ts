import type { NoteEv, Piece } from './pieces'
import type { Piano } from './audio'

export type Expression = {
  dyn: number      // 0..1 overall loudness you are asking for
  wild: number     // 0..1 scruffiness -> velocity scatter
  bass: number     // 0..1 weight of your left hand
  treble: number   // 0..1 weight of your right hand
  height: number   // 0..1 where your hands are in frame -> brightness
}

export type FiredNote = { p: number; vel: number; t: number }

const DYN_MARKS: [number, string][] = [
  [0.10, 'ppp'], [0.20, 'pp'], [0.34, 'p'], [0.48, 'mp'],
  [0.62, 'mf'], [0.78, 'f'], [0.92, 'ff'], [1.01, 'fff'],
]
export const dynMark = (d: number) => DYN_MARKS.find(([t]) => d < t)?.[1] ?? 'fff'
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

/**
 * Beat follower.
 *
 * Your strikes are beat markers, not note triggers. From them we estimate a
 * period and then *predict* where the music should be at any instant,
 * interpolating between beats. The playhead chases that prediction through a
 * damped follower, so a mistimed stroke bends the tempo over ~80ms instead of
 * yanking a fistful of notes out in one frame. Stop waving and the prediction
 * asymptotes into the next beat rather than slamming into it — it reads as a
 * ritardando settling onto a fermata.
 */
export class Conductor {
  piece: Piece
  private piano: Piano
  private notes: NoteEv[]
  private idx = 0

  /** pulses per stroke of your hand. 1 = you wave every beat. */
  stride: number
  pos = 0                  // absolute pulses, monotonic
  private beatOrigin = 0   // pos of the most recent stroke
  period: number           // seconds per stroke
  started = false
  loops = 0

  private lastStrikeAt = -1
  private strikeCount = 0
  private hitLevel = 0.6
  intervals: number[] = []
  lastFired: FiredNote[] = []
  strikeFlash = 0
  lastHand: -1 | 1 = -1
  phase = 0                // 0..1 through the current stroke

  constructor(piece: Piece, piano: Piano) {
    this.piece = piece
    this.piano = piano
    this.notes = piece.notes
    this.stride = piece.stride
    this.period = (60 / piece.pulseBpm) * piece.stride
  }

  get playhead() { return this.pos % this.piece.loopAt }
  /** musical beats per minute, not strokes per minute */
  get bpm() { return (60 / this.period) * this.stride }
  get strokeBpm() { return 60 / this.period }
  get beatInBar() { return Math.floor(this.playhead) % this.piece.pulsesPerBar }
  get progress() { return this.playhead / this.piece.loopAt }
  get idleFor() { return this.lastStrikeAt < 0 ? 0 : performance.now() / 1000 - this.lastStrikeAt }

  /** 0 = metronomic, 1 = shambolic */
  get unsteadiness() {
    if (this.intervals.length < 3) return 0
    const xs = this.intervals.slice(-8)
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length)
    return Math.min(1, sd / mean / 0.45)
  }

  setStride(s: number) {
    this.period = (this.period / this.stride) * s
    this.stride = s
    this.beatOrigin = this.pos
  }

  /**
   * You mimed a keystroke. Returns false if we ignored it — anything landing
   * far inside the current beat is a wobble in the camera, not a new tempo,
   * and letting those through is what used to make the music bolt.
   */
  strike(now: number, strength: number, hand: -1 | 1): boolean {
    // Long enough to swallow camera double-triggers, short enough that a
    // genuine change of pace always gets through.
    const refractory = clamp(this.period * 0.42, 0.15, 0.34)
    if (this.started && now - this.lastStrikeAt < refractory) return false

    this.hitLevel += (strength - this.hitLevel) * 0.55
    this.strikeFlash = 1
    this.lastHand = hand

    if (!this.started) {
      this.started = true
      this.lastStrikeAt = now
      this.beatOrigin = 0
      this.strikeCount = 1
      return true
    }

    const dt = now - this.lastStrikeAt
    if (dt < 3.5) {
      const ratio = dt / this.period
      // Believe a new tempo more while you're settling in, much less when it
      // looks like a stumble rather than a real change of pace.
      let trust = this.strikeCount < 5 ? 0.45 : 0.26
      if (ratio < 0.65 || ratio > 1.6) trust *= 0.35
      this.period = clamp(this.period * (1 - trust) + dt * trust, 0.28, 2.6)
      this.intervals.push(dt)
      if (this.intervals.length > 16) this.intervals.shift()
    }
    this.lastStrikeAt = now
    this.beatOrigin += this.stride
    this.strikeCount += 1
    return true
  }

  update(dt: number, now: number, ex: Expression) {
    this.strikeFlash = Math.max(0, this.strikeFlash - dt * 4.5)
    this.lastFired = []
    if (!this.started) return

    // where the music *should* be if you keep going at this pace
    let frac = (now - this.lastStrikeAt) / this.period
    if (frac > 0.88) frac = 0.88 + 0.12 * (1 - Math.exp(-(frac - 0.88) * 1.1))
    this.phase = Math.min(1, frac)
    const target = this.beatOrigin + frac * this.stride

    // Damped chase: a late or early stroke is absorbed over ~80ms. The rate
    // cap means even a big correction comes out as a quick flourish rather
    // than a fistful of notes in one frame.
    const wasLoop = Math.floor(this.pos / this.piece.loopAt)
    const maxRate = (4 * this.stride) / this.period
    const pull = (target - this.pos) * Math.min(1, dt * 13)
    this.pos = Math.max(this.pos, this.pos + Math.min(pull, maxRate * dt))

    if (Math.floor(this.pos / this.piece.loopAt) !== wasLoop) {
      this.idx = 0
      this.loops += 1
    }

    const head = this.playhead
    while (this.idx < this.notes.length && this.notes[this.idx].b <= head + 1e-6) {
      this.fire(this.notes[this.idx++], now, ex)
    }
  }

  private fire(n: NoteEv, now: number, ex: Expression) {
    const secPerPulse = this.period / this.stride

    // Metric accent: notes landing on a beat carry the weight of your stroke,
    // notes between beats are passing detail. Downbeats get a touch more.
    const onBeat = 1 - Math.min(1, Math.abs(n.b - Math.round(n.b)) * 4)
    const bar = n.b % this.piece.pulsesPerBar < 1e-6 ? 1.07 : 1
    const accent = (0.86 + onBeat * 0.2) * bar

    const hit = 0.55 + this.hitLevel * 0.6 * (0.4 + onBeat * 0.6)
    const level = 0.4 + ex.dyn * 0.9
    const lift = 0.88 + ex.height * 0.24          // hands high = brighter
    const isBass = n.p < 60
    const bal = isBass ? 0.75 + ex.bass * 0.5 : 0.75 + ex.treble * 0.5
    const scatter = 1 + (Math.random() - 0.5) * ex.wild * 0.55

    const vel = clamp(n.v * accent * hit * level * lift * bal * scatter, 0.05, 1)

    this.piano.play({
      midi: n.p,
      vel,
      dur: n.d * secPerPulse,
      release: this.piece.release * (0.75 + ex.dyn * 0.5),
      pan: (isBass ? -0.22 : 0.18) + (ex.treble - ex.bass) * 0.28,
    })
    this.lastFired.push({ p: n.p, vel, t: now })
  }

  reset() {
    this.idx = 0
    this.pos = 0
    this.beatOrigin = 0
    this.lastStrikeAt = -1
    this.strikeCount = 0
    this.started = false
    this.loops = 0
    this.intervals = []
    this.period = (60 / this.piece.pulseBpm) * this.stride
  }

  /** Notes coming up, for the falling-note display. */
  upcoming(window: number): NoteEv[] {
    const head = this.playhead
    const out: NoteEv[] = []
    for (let i = Math.max(0, this.idx - 6); i < this.notes.length; i++) {
      const n = this.notes[i]
      if (n.b > head + window) break
      if (n.b > head - 0.4) out.push(n)
    }
    // wrap the display around the loop point so it never goes blank
    const over = head + window - this.piece.loopAt
    if (over > 0) {
      for (const n of this.notes) {
        if (n.b > over) break
        out.push({ ...n, b: n.b + this.piece.loopAt })
      }
    }
    return out
  }
}
